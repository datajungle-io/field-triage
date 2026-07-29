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
| `LeadSource` | `Website` (override with `CRM_LEAD_SOURCE`) |
| `Website_Form__c` | `Field Triage` (override with `CRM_WEBSITE_FORM`) |

Deliberately no field counts. The numbers live in the report; duplicating them
onto the Lead means they go stale the next time the org is scanned.

CLI-session scans never push — our own test runs are not leads.

## 1. Deploy the custom field and permission set — DONE

```bash
cd salesforce/crm-pbo
sf project deploy start --target-org pbo --source-dir force-app
sf org assign permset --name Field_Triage_CRM_Writer --target-org pbo
```

Already applied to the PBO. Both steps are required, and the second is the
non-obvious one.

`Field_Triage_Org_Id__c` is Text(18), **External Id** and **Unique**. Both flags
are load-bearing: the app PATCHes
`/sobjects/Lead/Field_Triage_Org_Id__c/{orgId}` and lets Salesforce decide
insert-vs-update. Without them that endpoint 400s and every re-scan would create
a duplicate Lead.

> **A Metadata API field deploy grants field-level security to nobody** — not
> even System Administrator. The deploy reports `Created` and the field is
> genuinely there in the Tooling API, but it is absent from
> `sobjects/Lead/describe` and every write to it fails with `INVALID_FIELD`.
> Deploying via the UI hides this, because the UI's FLS checkboxes are a
> separate step that the Metadata API has no equivalent for.
>
> `Field_Triage_CRM_Writer` is what makes the field visible. **Assign it to the
> JWT integration user**, whoever that ends up being — assigning it to yourself
> is not enough if the integration runs as someone else.

Verify with:

```bash
sf data query --target-org pbo \
  --query "SELECT Parent.Profile.Name, PermissionsEdit FROM FieldPermissions \
           WHERE SobjectType='Lead' AND Field='Lead.Field_Triage_Org_Id__c'"
```

Zero rows means nothing can see the field, whatever the deploy said.

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

## 3b. Interim: SOAP login (no Connected App needed)

Connected App creation in the PBO is pending a Salesforce approval
(case #474206513). Until it clears, the push can authenticate with the SOAP
`login()` call instead.

This works where OAuth doesn't because `login()` predates Connected Apps —
username, password + security token, session id, no OAuth client anywhere in
the exchange. The returned session id behaves exactly like an access token
against the REST API, so only the credential swaps; the upsert is unchanged.

```
SF_CRM_USERNAME       = brendan@datajungle.io
SF_CRM_PASSWORD       = <the account password>
SF_CRM_SECURITY_TOKEN = <from Setup → My Personal Information → Reset My Security Token>
```

`config()` prefers JWT whenever `SF_CRM_CLIENT_ID` and `SF_CRM_PRIVATE_KEY` are
both present, so migrating later means **adding** two variables — no code
change, and no window where both paths are live. Delete the password pair once
JWT is confirmed working.

Treat this as temporary, for reasons that are not academic:

- It hands over a **full user session**, not a scoped grant. JWT can be limited
  to `api`; this cannot be limited at all.
- It **breaks silently on password rotation** — the security token is
  regenerated whenever the password changes, and the next scan simply logs a
  failed push.
- **Profile login IP ranges will block it.** Netlify's egress addresses are
  dynamic, so if the user's profile restricts login IPs this fails in production
  while working from your laptop. Check Setup → Profiles → Login IP Ranges
  before relying on it.
- The password and token in environment variables are a shared secret in a way
  a certificate's public half is not.

## 4. Environment variables

```
SF_CRM_CLIENT_ID    = <Consumer Key from the Connected App>
SF_CRM_USERNAME     = brendan@datajungle.io
SF_CRM_PRIVATE_KEY  = <contents of ~/.field-triage-crm/server.key>
SF_CRM_LOGIN_URL    = https://login.salesforce.com   (optional, this is the default)
CRM_LEAD_SOURCE     = <optional>
CRM_WEBSITE_FORM    = <optional>
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
