import { API_VERSION } from "@/lib/constants";

/**
 * Salesforce API client — TypeScript port of salesforce/jobs/sfcli.py plus the
 * HTTP helpers in ingest_field_references.py.
 *
 * Covers four transports, because the field census needs all of them:
 *   REST      — describe, describe/layouts, Analytics report describe
 *   SOQL      — record counts and aggregates (query / queryAll)
 *   Tooling   — FieldDefinition, CustomField, FlexiPage, MetadataComponentDependency
 *   SOAP MD   — ReportType retrieve (the REST Metadata API can't do this)
 */

export class SalesforceError extends Error {
  readonly status: number;
  readonly errorCode?: string;
  readonly body: string;

  constructor(message: string, status: number, body: string, errorCode?: string) {
    super(message);
    this.name = "SalesforceError";
    this.status = status;
    this.body = body;
    this.errorCode = errorCode;
  }

  /**
   * True when the token is dead — the scan cannot recover and must fail rather
   * than burn ticks retrying. Distinct from a permission error on one component,
   * which is expected and gets recorded as a coverage gap.
   */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.errorCode === "INVALID_SESSION_ID";
  }

  /** Permission/visibility failure on a single component — degrade, don't abort. */
  get isPermissionFailure(): boolean {
    return (
      this.status === 403 ||
      this.errorCode === "INSUFFICIENT_ACCESS" ||
      this.errorCode === "API_DISABLED_FOR_ORG"
    );
  }
}

export interface SalesforceCredentials {
  instanceUrl: string;
  accessToken: string;
}

interface QueryOptions {
  tooling?: boolean;
  /** queryAll — includes archived and recycle-bin rows. Required for Task/Event. */
  includeDeleted?: boolean;
  /**
   * Stop after this many records. Guards against a runaway query on a large org
   * chewing through an entire tick; callers that cap must disclose it.
   */
  maxRecords?: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export class SalesforceClient {
  readonly instanceUrl: string;
  private readonly accessToken: string;

  constructor(creds: SalesforceCredentials) {
    // Normalise: OAuth returns a full origin, but SOAP endpoints are built by
    // string concatenation and a trailing slash produces a 404 that looks like a
    // permission problem.
    this.instanceUrl = creds.instanceUrl.replace(/\/+$/, "");
    this.accessToken = creds.accessToken;
  }

  // -------------------------------------------------------------------------
  // Core HTTP
  // -------------------------------------------------------------------------

  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.instanceUrl}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(90_000),
        });
      } catch (err) {
        lastError = err;
        if (attempt === MAX_ATTEMPTS) break;
        await backoff(attempt);
        continue;
      }

      if (res.ok) return (await res.json()) as T;

      const body = await res.text();
      const errorCode = parseErrorCode(body);

      // Retry transient failures only. A 400 is a malformed SOQL query and will
      // fail identically forever — the population bisect depends on getting that
      // answer immediately rather than after three timeouts.
      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt, res.headers.get("Retry-After"));
        continue;
      }

      throw new SalesforceError(
        `${res.status} ${res.statusText} for ${url.pathname}: ${body.slice(0, 300)}`,
        res.status,
        body,
        errorCode,
      );
    }

    throw new SalesforceError(
      `Request failed after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`,
      0,
      String(lastError),
    );
  }

  // -------------------------------------------------------------------------
  // SOQL / Tooling
  // -------------------------------------------------------------------------

  /**
   * Runs a query and follows nextRecordsUrl to completion.
   *
   * Paging matters more than it looks: the Python version originally hand-rolled
   * this and silently dropped pages (21,714 FieldPermissions in the org vs 20,614
   * fetched). Undercounting here would understate dependencies, which is the one
   * direction this tool must never be wrong in.
   */
  async query<T = Record<string, unknown>>(
    soql: string,
    opts: QueryOptions = {},
  ): Promise<T[]> {
    const base = opts.tooling
      ? `/services/data/${API_VERSION}/tooling/query/`
      : `/services/data/${API_VERSION}/${opts.includeDeleted ? "queryAll" : "query"}/`;

    const records: T[] = [];
    let page = await this.get<QueryResponse<T>>(base, { q: soql });
    records.push(...(page.records ?? []));

    while (page.nextRecordsUrl) {
      if (opts.maxRecords && records.length >= opts.maxRecords) break;
      page = await this.get<QueryResponse<T>>(page.nextRecordsUrl);
      records.push(...(page.records ?? []));
    }

    return opts.maxRecords ? records.slice(0, opts.maxRecords) : records;
  }

  /** Single-row aggregate helper — COUNT() queries return exactly one record. */
  async queryAggregate(
    soql: string,
    includeDeleted = false,
  ): Promise<Record<string, unknown>> {
    const rows = await this.query<Record<string, unknown>>(soql, { includeDeleted });
    return rows[0] ?? {};
  }

  // -------------------------------------------------------------------------
  // Describe
  // -------------------------------------------------------------------------

  async describe(sobject: string): Promise<DescribeResult> {
    return this.get<DescribeResult>(
      `/services/data/${API_VERSION}/sobjects/${sobject}/describe`,
    );
  }

  /** Page layouts for an object — the source of the on_layout flag. */
  async describeLayouts(sobject: string): Promise<LayoutDescribe> {
    return this.get<LayoutDescribe>(
      `/services/data/${API_VERSION}/sobjects/${sobject}/describe/layouts/`,
    );
  }

  /**
   * Analytics report describe. Only reportMetadata is of interest: it contains
   * what the report actually uses, whereas the other describe sections list the
   * whole available-field catalog for the report type and would match every
   * field on the object.
   */
  async describeReport(reportId: string): Promise<{ reportMetadata?: unknown }> {
    return this.get(`/services/data/${API_VERSION}/analytics/reports/${reportId}/describe`);
  }

  // -------------------------------------------------------------------------
  // SOAP Metadata API — needed only for ReportType retrieve
  // -------------------------------------------------------------------------

  async metadataSoap(bodyXml: string): Promise<string> {
    const version = API_VERSION.replace(/^v/, "");
    const envelope =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
      'xmlns:met="http://soap.sforce.com/2006/04/metadata">' +
      `<soapenv:Header><met:SessionHeader><met:sessionId>${this.accessToken}</met:sessionId>` +
      "</met:SessionHeader></soapenv:Header>" +
      `<soapenv:Body>${bodyXml}</soapenv:Body></soapenv:Envelope>`;

    const res = await fetch(`${this.instanceUrl}/services/Soap/m/${version}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8", SOAPAction: '""' },
      body: envelope,
      signal: AbortSignal.timeout(120_000),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new SalesforceError(
        `SOAP ${res.status}: ${extractSoapFault(text) ?? text.slice(0, 300)}`,
        res.status,
        text,
        extractSoapFaultCode(text),
      );
    }
    return text;
  }

  // -------------------------------------------------------------------------
  // Identity / lifecycle
  // -------------------------------------------------------------------------

  async userInfo(): Promise<UserInfo> {
    return this.get<UserInfo>(`/services/oauth2/userinfo`);
  }

  /**
   * Best-effort token revocation. Called in finalize and by the reaper so the
   * grant we were given stops working the moment the scan no longer needs it —
   * the promise made on the connect screen.
   */
  async revoke(loginHost: string): Promise<boolean> {
    try {
      const res = await fetch(`${loginHost}/services/oauth2/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: this.accessToken }),
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueryResponse<T> {
  records?: T[];
  nextRecordsUrl?: string;
  done?: boolean;
  totalSize?: number;
}

export interface DescribeField {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  /** COUNT(field) requires this. */
  aggregatable?: boolean;
  /** `WHERE field = true` requires this. */
  filterable?: boolean;
  calculated?: boolean;
  nillable?: boolean;
  deprecatedAndHidden?: boolean;
  inlineHelpText?: string | null;
}

export interface DescribeResult {
  name: string;
  label: string;
  fields: DescribeField[];
}

export interface LayoutDescribe {
  layouts?: Array<{
    id: string;
    detailLayoutSections?: LayoutSection[];
    editLayoutSections?: LayoutSection[];
  }>;
}

interface LayoutSection {
  layoutRows?: Array<{
    layoutItems?: Array<{
      layoutComponents?: Array<{ type?: string; value?: string }>;
    }>;
  }>;
}

export interface UserInfo {
  user_id: string;
  organization_id: string;
  preferred_username?: string;
  name?: string;
  email?: string;
  urls?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function backoff(attempt: number, retryAfter?: string | null): Promise<void> {
  const headerMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const ms = Number.isFinite(headerMs) ? headerMs : 2 ** (attempt - 1) * 1000;
  await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10_000)));
}

/** Salesforce REST errors arrive as `[{"message":…,"errorCode":…}]`. */
function parseErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return typeof first?.errorCode === "string" ? first.errorCode : undefined;
  } catch {
    return undefined;
  }
}

function extractSoapFault(xml: string): string | undefined {
  return /<faultstring>([\s\S]*?)<\/faultstring>/.exec(xml)?.[1];
}

function extractSoapFaultCode(xml: string): string | undefined {
  const code = /<faultcode>([\s\S]*?)<\/faultcode>/.exec(xml)?.[1];
  return code?.split(":").pop();
}
