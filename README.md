# Field Triage — free Salesforce lead magnet

> ### ⚠️ This repo is mirrored publicly — keep them in sync
>
> | | |
> |---|---|
> | **Private** (this one) | `datajungle-io/field-triage` — Netlify builds from here |
> | **Public** | [`datajungle-io/field-triage-oss`](https://github.com/datajungle-io/field-triage-oss) — linked from [/security](https://triage.datajungle.io/security) |
>
> **`git push origin main` already pushes to both.** `origin` has two push URLs
> configured, so the ordinary command mirrors automatically and there is nothing
> extra to remember.
>
> The one thing that matters: **never let them diverge.** The security page tells
> sceptical admins to read the public source before granting OAuth access. If the
> deployed site ever does something the published code doesn't show, that
> discrepancy is far more damaging than never open-sourcing it would have been.
>
> If you ever push with `--force`, or push a branch by URL, check both remotes
> afterwards:
>
> ```bash
> git remote -v | grep push        # expect two push URLs
> git ls-remote https://github.com/datajungle-io/field-triage-oss.git main
> ```
>
> Client names are scrubbed from this history (see the commit that removed them).
> Keep it that way — no real org names, instance URLs or org statistics in commit
> messages or code comments, because every commit here reaches the public mirror.

A Salesforce admin OAuths their org, watches a live metadata scan, and lands on what looks
like their own instance of Data Jungle: the same sidebar, KPI tiles, By Object table and
health bars as the Field Triage page in `canopy-data-jungle`. The report is real,
org-specific, and immediately actionable.

The OAuth **is** the lead capture — Salesforce's identity endpoint returns a verified name,
email and org, so there is no form anywhere in the product.

## Parity with the production pipeline

This is a port of the Data Jungle field-census pipeline, collapsed from
(Airbyte → BigQuery → dbt → Evidence) into (Salesforce → Postgres → Next.js). All four
reference sources are implemented, because [no single Salesforce API covers
them all](../../instances/canopy-data-jungle/salesforce/jobs/ingest_field_references.py):

| Source | Covers | Ported from |
|---|---|---|
| `MetadataComponentDependency` (Tooling) | Layouts, Apex, Flows, Validation Rules, formula fields, Email Templates, Web Links, Aura/LWC | `ingest_field_references.py` |
| Report describe sweep (Analytics REST) | Reports — **MCD omits these entirely** | `ingest_field_references.py` |
| FlexiPage metadata (Tooling, per-Id) | Lightning record pages | `ingest_field_references.py` |
| ReportType (Metadata API SOAP `retrieve`) | Custom report types — block deletion even when unused | `ingest_field_references.py` |
| `describe/layouts/` (REST) | `on_layout` | `ingest_field_layouts.py` |
| SOQL `COUNT()` aggregates | Population % — the `<1%` delete-ready signal | `ingest_field_population_sf.py` |
| Tooling `FieldDefinition` + `CustomField` | Field list, namespace, last-modified, 18-char Ids | `ingest_field_definition.py` |

`dbt/models/marts/field_census/fct_field_census.sql` is ported to the `field_census` view in
`supabase/migrations/0001_init.sql`, and the Evidence page's SQL blocks to the functions in
`0002_report_functions.sql`. Same expressions, same thresholds, same NULL semantics.

**Scope is deliberately narrower than production.** The lead magnet scans four core objects
— Lead, Account, Contact, Opportunity — where production tracks eleven. Most orgs have no
custom fields on Quote/Contract/Order/Asset/Campaign, so those rows were noise, and
Task/Event carry the scan's messiest special-casing (shared `Activity` entity, `queryAll`
for archived rows) for few findings. On the reference org the four still capture 25 of 29
custom fields. It saves the population phase but not much wall-clock — the report sweep
dominates and is org-wide. One constant: `CORE_OBJECTS` in `src/lib/constants.ts`; set
`OBJECTS = ALL_OBJECTS` to restore full parity.

### Two deliberate changes on the way over

- **MCD truncation guard.** The production job issues one unfiltered
  `WHERE RefMetadataComponentType = 'CustomField'`, which is correct on our orgs but can
  silently truncate at the 2,000-row cap on a large one. Landing near the cap now triggers a
  chunked `RefMetadataComponentId IN (...)` re-query. A truncated dependency list reads as
  "no dependencies", which is the most dangerous wrong answer this tool can give.
- **`is_safe_to_delete` is `coalesce(..., false)`.** In BigQuery the predicate is
  three-valued: `population_pct < 0.01` is NULL for every unmeasurable field, so
  `is_safe_to_delete` is NULL too. Every current consumer treats NULL as falsy, but a future
  `where not is_safe_to_delete` would silently drop those rows. Unmeasured is a definite no.

## Architecture

```
Browser ──OAuth──> Salesforce
   │                   ▲
   │ tick + refresh    │ REST / Tooling / Analytics / SOAP
   ▼                   │
Supabase <──────── /api/scan/tick  (resumable, Node runtime)
```

The scan is a **resumable job, not a request**. Each tick claims the next unfinished phase,
works for ~35s, persists a cursor, and returns. The browser drives ticks while the report
page is open (which is what makes progress live); a Vercel Cron resumes anything abandoned.
No phase knows it is running serverless.

Progressive reveal falls out of the census being a SQL **view**: it widens as reference rows
land, so re-rendering the page yields updated dependency counts with no client state to
reconcile. The report appears as soon as `population` completes — dependency-derived cells
show a pending state until every reference source settles.

| # | Phase | Optional | Notes |
|---|---|---|---|
| 1 | `identity` | no | userinfo + `Organization` → creates the lead |
| 2 | `field_definitions` | no | per-object `FieldDefinition` + `CustomField` Id map |
| 3 | `population` | no | **first paint** — report renders after this |
| 4 | `dependencies_mcd` | yes | bulk, with chunked fallback |
| 5 | `layouts` | yes | `on_layout` |
| 6 | `flexipages` | yes | per-Id metadata |
| 7 | `reports` | yes | the long pole — one describe per report |
| 8 | `report_types` | yes | SOAP retrieve, polled across ticks |
| 9 | `finalize` | no | **revokes the token**, emails the permalink |

Every reference source is optional. An org that locks down the Metadata API still gets a
real report, with the gap stated on its face via the coverage banner — the equivalent of
production's `field_reference_scan_stats`. A source that failed must never be
indistinguishable from a source that found nothing.

## Setup

### 1. Supabase

Create a project, then apply every migration in order:

```bash
SUPABASE_DB_URL='postgresql://…' npm run db:push
```

`0003` is not optional. RLS on the tables does not protect the views (views don't inherit
RLS) and does not protect `purge_expired_scans` (RPC-callable, and it DELETEs). That
migration revokes everything from `anon` and `authenticated`, including default privileges
so a later migration can't reopen it.

### 2. Salesforce Connected App

> **Why not an External Client App?** ECAs are the successor and Connected App creation is
> already disabled by default in newer orgs. We migrated, and it worked — for users of the
> org that defined it. Any other org fails with
> `OAUTH_AUTHORIZATION_BLOCKED: Cross-org OAuth flows are not supported for this external
> client app`. That is fatal here: the entire premise is that a stranger's org connects
> without installing anything. `distributionState: Packaged` would presumably lift the
> restriction, but a packaged app must be installed in the target org first — the same
> problem in different clothing. **Connected Apps remain the only mechanism supporting
> anonymous cross-org OAuth.** The ECA metadata is kept under
> `externalClientApps/` for whenever Salesforce ships an equivalent.
>
> Consequence: the app must live in an org that permits Connected App creation. Newer orgs
> (including the CS Toolkit PBO) need a support case to enable it.

Deployed as metadata from `salesforce/`, not clicked through Setup, so the configuration is
reviewable and reproducible:

```bash
cd salesforce
sf project deploy start --target-org <alias> --metadata ConnectedApp

# Salesforce generates the consumer key on create — retrieve to read it
sf project retrieve start --target-org <alias> --metadata ConnectedApp:Field_Triage \
  --target-metadata-dir /tmp/ca
# then unzip and read <consumerKey> into SF_CLIENT_ID
```

Settings that matter:

- **`isAdminApproved: false`** — any user self-authorizes. The alternative requires every
  prospective user's org to pre-approve the app, which for a public lead magnet means
  nobody can use it.
- **`isConsumerSecretOptional: true`** so setup can be fully scripted. Salesforce will not
  release a consumer secret over any API — only the key is retrievable — so a scripted
  deploy could otherwise never finish. Safe because PKCE is mandatory; together they are
  the standard public-client configuration. Set `SF_CLIENT_SECRET` later to run as a
  confidential client; the code supports both.
- **No `RefreshToken` scope.** The app structurally cannot return to anyone's org.
- New apps take **2–5 minutes to propagate**; `invalid_client_id` before then is expected.

The consumer key works cross-org. Only orgs with API Access Control enabled need to
whitelist it explicitly.

<details>
<summary>External Client App notes (not in use — kept for when ECAs support cross-org)</summary>

The ECA metadata under `externalClientApps/`, `extlClntAppGlobalOauthSets/`,
`extlClntAppOauthSettings/` and `extlClntAppOauthPolicies/` is complete and deploys
cleanly. It is unused only because of the cross-org restriction above. What cost time to
work out, so it doesn't have to be rediscovered:

- **Naming is by convention**, not just the `externalClientApplication` field:
  `<App>_glbloauth`, `<App>_oauth`, and the auto-created `<App>_oauth_defaultPolicy`.
- **Scopes are `commaSeparatedOauthScopes`** — a single comma-separated string, not
  repeated `<scopes>` elements as in ConnectedApp — and they live on
  `ExtlClntAppOauthSettings`, not the global settings.
- **`isCodeCredFlowEnabled`** is what enables the web server (authorization code) flow.
  Without it the authorize endpoint rejects the request whatever the scopes say.
- **`permittedUsersPolicyType` is `AllSelfAuthorized`.** Deploy without the policy and read
  the enum off the record Salesforce auto-creates rather than guessing.
- **`ipRelaxationPolicyType` must be `Bypass`.** The auto-created default is `Enforce`,
  which fails any user whose org has login IP ranges, at the authorize step, with an error
  they can't diagnose.
- **Element order follows the XSD sequence.** Out-of-order elements are rejected outright.

</details>

### 3. Environment

Copy `.env.example` to `.env.local` and fill it in. Generate the encryption key with
`openssl rand -base64 32`.

### 4. Run

```bash
npm install
npm run dev
```

Deploy to Vercel. `vercel.json` registers the resume cron; set `CRON_SECRET` so the endpoint
isn't publicly triggerable.

> `maxDuration = 300` on the tick routes assumes Vercel Pro/Fluid. On Hobby (60s ceiling),
> lower `TICK_BUDGET_MS` in `src/lib/scan/types.ts` to ~20s.

## Trust posture

The biggest conversion risk is a stranger's app asking for production Salesforce access, so
it's designed for rather than disclaimed:

- Salesforce has no metadata-read-only scope. `api` is the narrowest grant that can read
  field definitions, and the connect screen says so plainly instead of burying it.
- **No `refresh_token`** is requested — we cannot return to the org later.
- The access token is AES-256-GCM encrypted at rest (it must survive between ticks), then
  **actively revoked** at `/services/oauth2/revoke` in `finalize` and by the reaper for
  abandoned scans.
- **No record data is stored.** Only `COUNT()` results and metadata. Not one field value.
- Scan payloads expire after 30 days; lead rows survive by design (`on delete set null`).

## Testing it end to end

### Offline — no accounts needed

```bash
npm run typecheck
npm run test:schema   # applies migrations to PGlite, asserts census semantics
npm run build
```

`test:schema` is the one that matters. It stands up a real Postgres in-process and asserts
the rules an admin will act on: the delete-ready predicate, the health buckets, and the
NULL-vs-0 dependency distinction that progressive reveal depends on. A regression there
deletes someone's live field.

### Against a real org — without a Connected App

The fastest way to exercise the whole pipeline. Uses the `sf` CLI's existing session in
place of OAuth, mirroring `SF_USE_CLI` in the production Python jobs. Every phase runs
against real metadata over the identical REST / Tooling / Analytics / SOAP code paths.

**1. Get a Postgres.** Either works; local needs no Supabase account at all.

<details open>
<summary><strong>Local stack (no account, needs Docker running)</strong></summary>

```bash
npx supabase start     # applies supabase/migrations automatically on first run
```

It prints an API URL and keys. Put them in `.env.local`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=<service_role key from the output>
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`npx supabase stop` tears it down; `--no-backup` also discards the data.
</details>

<details>
<summary><strong>Cloud project</strong></summary>

Create it in the dashboard, or from the CLI without touching the UI:

```bash
npx supabase login            # opens a browser for a personal access token
npx supabase projects create field-triage --region us-east-1
```

Then take the URL and service-role key from Project Settings > API, the URI from
Project Settings > Database (session pooler, **not** the transaction pooler — the
migrations create types and functions), and apply them:

```bash
npm run db:push
```
</details>

**Then finish the env file:**

```bash
cp .env.example .env.local   # if you haven't already
openssl rand -base64 32      # -> TOKEN_ENCRYPTION_KEY
```

`SF_CLIENT_ID` / `SF_CLIENT_SECRET` can stay empty — the CLI path never touches OAuth.

**2. Run a scan:**

```bash
npm run dev:cli
open 'http://localhost:3000/api/dev/scan?org=admin-user'
```

You'll land on the live scan screen, then the report once population finishes. Try
Point `?org=` at a large real org — that's the one that will actually stress the report
sweep and the ReportType retrieve.

> Scans started this way are flagged `is_cli_session`, so finalize skips revocation. Without
> that, testing would log you out of `sf` for that org.

### The OAuth path

Needs the Connected App from step 2 of Setup. Once `SF_CLIENT_ID` / `SF_CLIENT_SECRET` are
set, `npm run dev` and click Connect. Worth doing before launch — it's the only way to
verify the consent screen, PKCE, and that revocation actually fires.

## Verification status

### Done

- **Full scan, end to end** against `admin-user` (Brendan McDonald Consulting) via the CLI
  path: all 9 phases complete, 602 fields across 10 objects, 11 delete-ready, 6 with zero
  dependencies. The ReportType SOAP retrieve — the most fragile piece — completed 12/12.
- **Dependency counts match production.** Account 8, Contact 8, Lead 9, Opportunity 18,
  zero elsewhere — identical to the Data Jungle Field Triage page for the same org. Strong
  evidence the four-source reference pipeline is faithfully ported.
- **Degradation.** `Quote` isn't enabled in that org: `FieldDefinition` returned 0 rows and
  `describe` 404'd. Both phases recorded the failure and carried on. 24 of 31 reports were
  unreadable (folder permissions) and the coverage banner surfaced it verbatim rather than
  quietly undercounting.
- **CLI session preserved.** `token_revoked_at` is null for `is_cli_session` scans and
  `sf org display` still reports `Connected` afterwards.
- **OAuth path, end to end**, against the External Client App in the CS Toolkit PBO: state
  and PKCE validated, token exchanged with no client secret, lead captured from the identity
  endpoint with no form, all 9 phases green (141/142 reports, 31/31 report types).
- **Revocation, proven not inferred.** The access token was captured mid-scan and replayed
  after `finalize`: `401 INVALID_SESSION_ID` on both REST and Tooling. The connect screen's
  promise holds.
- **Census semantics.** `npm run test:schema`, 30 assertions.

### Still open

1. **Ground truth.** Scan the org behind `canopy-data-jungle` and diff the census against
   `fct_field_census` in BigQuery — field counts, per-bucket counts, `delete_ready`,
   `ready_no_deps`. The dependency match above is suggestive; this is the one that proves it.
2. **Reference parity, formally.** Compare ~10 fields against Salesforce Setup's own "Where
   is this used?" button. That button is the spec.
3. **Scale.** Run against a large org (Unlimited Edition). `admin-user` has only 29 custom
   fields, so the MCD 2,000-row cap was never approached and the chunked fallback has not
   executed against real data.
4. **Resumability.** Cursors advanced across many ticks, but a hard kill mid-report-sweep
   followed by cron resume has not been tested.
5. **Custom objects.** Not scanned at all, by design — but an org whose real cruft sits on
   `Widget__c` gets a report covering little of what matters. State it, don't let people
   discover it.

## Known gaps, disclosed in-product

- Four core objects only — Lead, Account, Contact, Opportunity. Set `OBJECTS = ALL_OBJECTS`
  in `src/lib/constants.ts` to restore the production 11. Custom objects are never scanned.
- Standard fields get no dependency tracking — Salesforce's own button doesn't either.
- ReportType coverage requires Metadata API access.
- Reports in folders the connecting user can't see return 403 and are counted as failed.
- `Fields Deleted` needs a prior snapshot, so it is always 0 on a one-off scan. The tile
  says so and points at the ongoing product.
