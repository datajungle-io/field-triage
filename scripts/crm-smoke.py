"""Smoke-test the CRM upsert payload without the JWT Connected App.

The Connected App is pending, which blocks the *auth* half of the CRM push. The
payload half — field API names, the LeadSource value, Website_Form__c, and the
External Id upsert semantics — can be proven now with the `sf` CLI's session
token, which is an ordinary access token for the same org.

Builds the identical record that src/lib/crm.ts builds, PATCHes the identical
endpoint, and runs twice to prove the second call updates rather than
duplicates. When the Connected App lands, only the token source changes.

Usage:
    python3 scripts/crm-smoke.py <path-to-sf-org-display-json> <scan-token>
"""

import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "v62.0"
ORG_ID_FIELD = "Field_Triage_Org_Id__c"
PUBLIC_ORIGIN = "https://triage.datajungle.io"


def db_row(dsn, sql):
    out = subprocess.run(
        ["psql", dsn, "-tAq", "-F", "\x1f", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return out.split("\x1f") if out else None


def call(base, token, method, path, body=None):
    req = urllib.request.Request(
        base + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def split_name(full):
    full = (full or "").strip()
    if not full:
        return None, "Unknown"
    at = full.rfind(" ")
    return (None, full) if at < 0 else (full[:at], full[at + 1:])


def main():
    org_json, scan_token, dsn = sys.argv[1], sys.argv[2], sys.argv[3]
    d = json.load(open(org_json))["result"]
    base, token = d["instanceUrl"].rstrip("/"), d["accessToken"]

    row = db_row(dsn, f"""
        select coalesce(l.name,''), coalesce(l.email,''), coalesce(l.org_id, s.org_id),
               coalesce(l.org_name, s.org_name, ''), coalesce(l.org_type, s.org_type, ''),
               s.is_sandbox, s.created_at::date, s.token
        from scans s left join leads l on l.scan_id = s.id
        where s.token = '{scan_token}'
    """)
    if not row:
        sys.exit(f"no scan for token {scan_token}")

    name, email, org_id, org_name, org_type, is_sandbox, created, tok = row
    first, last = split_name(name)

    record = {
        "LastName": last,
        "Company": org_name or (email.split("@")[1] if "@" in email else "Unknown"),
        "Email": email,
        "LeadSource": "Website",
        "Website_Form__c": "Field Triage",
        "Description": (
            f"Field Triage report: {PUBLIC_ORIGIN}/r/{tok}\n"
            f"Scanned {created}"
            + (f" · {org_type}" if org_type else "")
            + (" · sandbox" if is_sandbox == "t" else "")
        ),
    }
    if first:
        record["FirstName"] = first

    print("Upserting on", ORG_ID_FIELD, "=", org_id)
    print(json.dumps(record, indent=2))

    path = f"/services/data/{API}/sobjects/Lead/{ORG_ID_FIELD}/{urllib.parse.quote(org_id)}"

    for attempt in (1, 2):
        status, body = call(base, token, "PATCH", path, record)
        print(f"\nPASS {attempt}: HTTP {status} -> {body}")
        if status not in (200, 201, 204):
            sys.exit("upsert failed — payload is wrong, fix before wiring JWT")

    status, found = call(
        base, token, "GET",
        f"/services/data/{API}/query/?q=" + urllib.parse.quote(
            "SELECT Id, Name, Company, Email, LeadSource, Website_Form__c, "
            f"{ORG_ID_FIELD}, CreatedDate, LastModifiedDate FROM Lead "
            f"WHERE {ORG_ID_FIELD} = '{org_id}'"
        ),
    )
    print(f"\nLeads matching that org ID: {found['totalSize']} (must be 1 — proves upsert, not insert)")
    for rec in found["records"]:
        print(json.dumps({k: v for k, v in rec.items() if k != "attributes"}, indent=2))


if __name__ == "__main__":
    main()
