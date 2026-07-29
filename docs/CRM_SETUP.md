# CRM push — setup

Completed scans upsert a Lead into the Data Jungle CRM
(`brendanmcdonaldconsulting.my.salesforce.com`, the `pbo` alias).

This is a **different org** from the one being scanned. The scan holds a
short-lived token for the prospect's org which is revoked the moment the scan
finishes; writing a Lead needs a standing credential in our own org. The two
credential sets are deliberately separate (`SF_CLIENT_ID` vs `SF_CRM_CLIENT_ID`)
and must not be crossed.

Until the variables below are set the push is a **no-op** — it logs a skip and
the scan completes normally. Nothing here blocks shipping.

## What gets written

| Lead field | Value |
| --- | --- |
| `FirstName` / `LastName` | Split from the OAuth display name on the last space |
| `Company` | Org name (falls back to the email domain) |
| `Email` | The verified address from the OAuth identity endpoint |
| `Description` | Report URL, scan date, org edition |
| `Field_Triage_Org_Id__c` | The 18-char org ID — the upsert key |
| `LeadSource` | Only if `CRM_LEAD_SOURCE` is set (see note below) |

Deliberately no field counts. The numbers live in the report; duplicating them
onto the Lead means they go stale the next time the org is scanned.

CLI-session scans never push — our own test runs are not leads.

## 1. Deploy the custom field

```bash
cd salesforce/crm-pbo
sf project deploy start --target-org pbo --source-dir force-app
```

`Field_Triage_Org_Id__c` is Text(18), **External Id** and **Unique**. Both flags
are load-bearing: the app PATCHes
`/sobjects/Lead/Field_Triage_Org_Id__c/{orgId}` and lets Salesforce decide
insert-vs-update. Without them that endpoint 400s and every re-scan would create
a duplicate Lead.

## 2. Certificate

Already generated at `~/.field-triage-crm/` (outside the repo — the private key
must never be committed):

- `server.crt` — upload to the Connected App
- `server.key` — becomes `SF_CRM_PRIVATE_KEY`

Valid to July 2036. To regenerate:

```bash
openssl req -x509 -sha256 -nodes -days 3650 -newkey rsa:2048 \
  -keyout ~/.field-triage-crm/server.key \
  -out   ~/.field-triage-crm/server.crt \
  -subj "/CN=field-triage/O=Data Jungle/C=CA"
```

## 3. Connected App in the PBO

Setup → App Manager → New Connected App, in
`brendanmcdonaldconsulting.my.salesforce.com`.

- Name: `Field Triage CRM Writer`
- Enable OAuth Settings: ✅
- Callback URL: `http://localhost:1717/OauthRedirect` (unused by JWT, but required)
- **Use digital signatures**: ✅ — upload `server.crt`
- Scopes: `Manage user data via APIs (api)`, `Perform requests at any time (refresh_token, offline_access)`
- Save, then **Manage → Edit Policies → Permitted Users =
  _Admin approved users are pre-authorised_**

Then assign the app to your own profile or a permission set. **The JWT flow
fails until this assignment exists** — that is the single most common cause of
`invalid_grant: user hasn't approved this consumer`.

## 4. Environment variables

```
SF_CRM_CLIENT_ID    = <Consumer Key from the Connected App>
SF_CRM_USERNAME     = brendan@datajungle.io
SF_CRM_PRIVATE_KEY  = <contents of ~/.field-triage-crm/server.key>
SF_CRM_LOGIN_URL    = https://login.salesforce.com   (optional, this is the default)
CRM_LEAD_SOURCE     = <optional>
```

On Netlify, paste the private key with real newlines; literal `\n` sequences are
also accepted and normalised. Mark `SF_CRM_CLIENT_ID` and `SF_CRM_PRIVATE_KEY`
as **secret**, and leave `SF_CRM_USERNAME` / `SF_CRM_LOGIN_URL` unmarked — the
secret scanner fails the build when a value it has been told is secret appears
in build output, which is how CD broke last time.

> `CRM_LEAD_SOURCE` is opt-in because `LeadSource` is a restricted picklist in
> many orgs, where an unknown value is a hard failure. Only set it to a value
> that already exists in the picklist.

## 5. Test

```bash
ALLOW_CLI_SCAN=1 npm run dev -- -p 3100
open 'http://localhost:3100/api/dev/crm-push?token=<report token>'
```

Runs the real push in strict mode and returns Salesforce's own error rather than
a summary of it. Writes a real Lead — but it upserts, so running it twice
updates rather than duplicates.

Expected: `{"pushed":true,"leadId":"00Q...","created":true}`.
