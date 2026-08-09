# Azure integration

Two independent, optional integrations:

| | What it adds | Where it plugs in |
|---|---|---|
| **Blob Storage** | Traces outlive a restart, so a shared link keeps resolving | `TraceArchive` behind the Caffeine cache |
| **Entra External ID** | Real sign-in and a real API boundary, replacing the local profile | `SecurityConfig` + MSAL in the SPA |

**Neither is required.** With every variable unset the app is byte-for-byte the
one that ran before Azure existed: sign-in is a local profile, traces are cached
in memory, and no Azure SDK code path is reached. That is a supported
configuration, not a degraded one — `docker compose up`, `mvn test` and a laptop
with no Azure account all depend on it. Turn them on one at a time.

**Setting this up on a new subscription?** [`provision.sh`](provision.sh) does
the mechanical parts, and [`MIGRATION.md`](MIGRATION.md) is the step-by-step
runbook for moving from an expiring subscription to a fresh one. This document
explains what each piece is and why; that one is the sequence to follow.

---

## Cost

Both integrations are chosen to sit inside always-free limits at this project's
scale, not to be paid for out of trial credit:

- **Blob Storage** bills for stored bytes and transactions. Traces are small
  JSON documents and, being content-addressed, are written once and never
  updated — so a re-run of the same snippet is not a billed write. Expect
  cents per month.
- **External ID** bills per monthly active user above a free tier. A personal
  project is comfortably inside it.

Prices and free-tier limits change, so confirm against
[Azure pricing](https://azure.microsoft.com/pricing/) and
[External ID pricing](https://aka.ms/ExternalIDPricing) rather than trusting the
numbers in a README.

Set a **budget alert** at $1 on the subscription anyway. It costs nothing and it
is the difference between noticing a mistake in a day and noticing it in a month.

```bash
# Lowercase enums are required; the CLI rejects Monthly/Cost. macOS date flags --
# on Linux use $(date -d '+1 year' +%Y-%m-01) for the end date.
az consumption budget create --budget-name visualizer-guard \
  --amount 1 --time-grain monthly --category cost \
  --start-date "$(date +%Y-%m-01)" --end-date "$(date -v+1y +%Y-%m-01)"
```

### On Azure for Students

$100 of credit for 12 months, no card, plus the free service tiers — and
**renewable** for another 12 months and another $100 while you are still a
student. Renewal is not automatic: you get an email around 30 days out and have
to re-verify.

Two things to know, because both end with a dead demo link rather than a warning:

- When the credit runs out **or** the 12 months lapse, the subscription is
  cancelled and the resources go with it. Upgrading to pay-as-you-go keeps
  everything alive and costs $0 while you stay inside the free tiers.
- Student verification can only be claimed once. If you burn it and later need a
  fresh subscription, there is no second student offer to fall back on.

At this project's scale the storage integration will consume cents of the $100,
so the credit is not the constraint. **Tenant creation permission is** — see the
pre-flight check in Part 2.

### When the student offer ends

Renewal requires re-verifying enrolment through an institutional email address at
each renewal point. After graduation that check fails — an alumni address
generally does not qualify — so **the offer ends permanently rather than
lapsing temporarily**. The only continuation path is upgrading to pay-as-you-go,
which is done by contacting Azure support rather than through a button.

Find the date this becomes urgent, and put it in a calendar now:
[microsoftazuresponsorships.com/balance](https://www.microsoftazuresponsorships.com/balance)
shows remaining credit and the expiration date. Decide *before* that date —
once the subscription is disabled, reactivating it means a support request.

Two options, both legitimate:

**Upgrade to pay-as-you-go.** Needs a card. Ongoing cost for this project is
well under a dollar a month: External ID stays inside its free MAU tier
indefinitely, and a few megabytes of trace blobs bills fractions of a cent once
the 12-month storage grant ends (that grant runs from your original sign-up
date, so upgrading does not extend it). Choose this if you want the live demo to
keep showing sign-in.

**Let it lapse and fall back.** The app is built to run with no Azure at all, so
the deployment keeps working — local-profile sign-in, in-memory cache, no
errors. You lose durable share links, and the integration lives on in the code
and in this document, which is what a reviewer actually reads. Costs nothing.

> **If you let it lapse, unset the auth variables. This part is not symmetric.**
>
> Storage failing is safe by design: the archive degrades to a cache miss and a
> run still succeeds. **Authentication failing is not.** With
> `VISUALIZER_AZURE_AUTH_ISSUER_URI` still set but the tenant gone, token
> validation fails and every `/api/**` call returns 401 — behind a sign-in
> button that can no longer complete. `/api/health` stays public, so the
> platform health check goes on passing and nothing alerts you. The app is
> bricked and looks fine.
>
> Clear `VISUALIZER_AZURE_AUTH_ISSUER_URI`, `VISUALIZER_AZURE_AUTH_AUDIENCE` and
> the three `VITE_AZURE_*` values, then redeploy. The `VITE_` ones are compiled
> into the bundle, so this needs a rebuild — on Render, changing an environment
> variable triggers one automatically. `AZURE_STORAGE_CONNECTION_STRING` is safe
> to leave set, though clearing it saves a pointless failing call per cache miss.

---

## Part 1 — Blob Storage

Start here. It is self-contained, needs no tenant, and is visible in the UI as
soon as it works.

### Create the account

Locally redundant (`Standard_LRS`) is the cheapest tier and the right one: the
blobs are a cache of things that can be recomputed by re-running the code, so
paying to replicate them across regions would be buying durability the data does
not need.

```bash
az login
az group create --name visualizer --location eastus

# The name becomes part of a public hostname, so it must be globally unique
# and lowercase-alphanumeric.
az storage account create \
  --name visualizertraces$RANDOM \
  --resource-group visualizer \
  --location eastus \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access false
```

`--allow-blob-public-access false` matters. The app reads blobs through the
backend, which is where rate limiting and (optionally) authentication live.
Public blobs would route around both and expose an enumerable store of
everything anyone has ever run.

### Wire it up

```bash
az storage account show-connection-string \
  --name <your-account-name> --resource-group visualizer --output tsv
```

Put it in `.env` (gitignored — the connection string contains the account key):

```
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_CONTAINER=traces
```

The container is created on first write, so there is nothing else to set up.

### Verify

```bash
docker compose up --build -d
```

Backend logs should say:

```
Trace archive enabled: Azure Blob Storage container 'traces'.
```

Then run a snippet in the UI, click **Share**, and paste the link in a new tab —
it should replay without re-executing. The real test is the one that fails
without Azure:

```bash
docker compose restart backend
```

Open the same link again. It still resolves, because the in-memory cache is gone
and the blob is not.

### Optional: expire old traces

Traces are recomputable, so keeping them forever is paying to store something you
could regenerate. A lifecycle rule caps the bill on its own:

```bash
az storage account management-policy create \
  --account-name <your-account-name> --resource-group visualizer \
  --policy '{"rules":[{"enabled":true,"name":"expire-traces","type":"Lifecycle",
    "definition":{"filters":{"blobTypes":["blockBlob"],"prefixMatch":[]},
    "actions":{"baseBlob":{"delete":{"daysAfterModificationGreaterThan":90}}}}}]}'
```

A link older than 90 days then goes cold, which the frontend already handles —
it says the trace expired and offers the editor.

---

## Part 2 — Entra External ID

External ID (the CIAM product) is the right fit rather than plain Entra ID:
anyone should be able to sign up for a public tool, which is what an *external*
tenant is for. A workforce tenant would mean hand-inviting every user.

### Pre-flight: can you create a tenant at all?

**Do this before anything else.** Creating an external tenant needs the
[Tenant Creator](https://learn.microsoft.com/entra/external-id/customers/quickstart-tenant-setup)
role scoped to your subscription. If your Azure account is a university address,
it lives in **your university's Entra tenant**, and universities very commonly
switch off tenant creation for non-admins. You cannot work around that from your
side — it is enforced above you.

Check which directory you are actually in:

```bash
az login
az account show --query "{subscription:name, tenant:tenantId, user:user.name}" -o table
```

If `user` is `you@youruniversity.edu`, assume the restriction may apply. The
definitive test takes a minute and is worth doing before you configure anything:

1. [entra.microsoft.com](https://entra.microsoft.com) → **Entra ID → Overview →
   Manage tenants → Create**
2. Pick **External** and try to proceed.

If it refuses, or **Create** is greyed out, tenant creation is blocked. Take the
fallback below rather than fighting it — asking a university admin to grant
Tenant Creator on a personal project is rarely a fight worth having, and the
fallback demonstrates the same protocol work.

### Fallback: a workforce tenant app registration

If external tenants are blocked, register the app **in the directory you already
have**. You get real OIDC — the same authorization code + PKCE flow, the same
JWT validation, the same code — with one limitation: only accounts from that
directory can sign in, rather than anyone on the internet.

**No application code changes.** Only the two authority-shaped values differ:

```
VITE_AZURE_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
VISUALIZER_AZURE_AUTH_ISSUER_URI=https://login.microsoftonline.com/<tenant-id>/v2.0
```

Everything else — client id, exposed scope, audience, redirect URIs — is
identical to the steps below; skip *Create the tenant* and *Create a user flow*
(user flows are an external-tenant feature; a workforce tenant signs in existing
directory accounts directly). `lib/auth.ts` derives `knownAuthorities` from
whatever authority you give it, so both hosts work unchanged.

If **App registrations → New registration** is *also* blocked, your directory has
disabled app registration for regular users too. At that point Part 2 is not
available to you on this account, and the honest move is to ship Part 1 alone —
the Blob Storage work stands perfectly well on its own.

### Create the tenant

An external tenant is **separate from your default directory**. In the
[Microsoft Entra admin center](https://entra.microsoft.com):

1. **Entra ID → Overview → Manage tenants → Create**
2. Choose **External**, then name it (e.g. `visualizer`). The subdomain you pick
   becomes `<subdomain>.ciamlogin.com`.
3. **Link it to your subscription.** Home → **Billing** → *Click here to
   upgrade* → **Add Subscription**. External ID requires this for billing, and
   an unlinked tenant will bite you later rather than immediately.

### Register the application

Switch to the external tenant first (Settings icon → **Directories +
subscriptions** → *Switch*), or you will register the app in the wrong
directory and spend an hour wondering why the authority 404s.

1. **App registrations → New registration**
   - Supported account types: **Accounts in this organizational directory only**
     (external tenants only support single-tenant).
   - Platform: **Single-page application (SPA)**
   - Redirect URI: `http://localhost:5173` for development. Add the production
     origin (e.g. `https://visualizer-igxk.onrender.com`) as a second SPA
     redirect URI later — the origin only, no path, because the app is
     configured with `redirectUri: window.location.origin`.
2. Record the **Application (client) ID**.
3. **Expose an API → Add a scope.** Accept the default
   `api://<client-id>` application ID URI, then create a scope named
   `Trace.Run`, admin-consent only.
4. **API permissions → Add a permission → My APIs →** your own app **→
   `Trace.Run`**. Then **Grant admin consent**.

That last step is not optional and is the step people skip. In an external
tenant, users cannot consent to permissions for themselves — an admin must
consent on their behalf, or every sign-in fails at the consent screen.

One app registration serves as both the SPA and the API here. Splitting them is
the textbook arrangement and is worth doing if you want the practice, but for a
single SPA calling a single backend it adds a second registration to keep in
sync and changes nothing about the security properties.

### Create a user flow

**External Identities → User flows → New user flow.** Enable *Email with
password* (and Google or Apple federation if you like), then associate the
application you just registered. Without this, the tenant has no sign-up
experience and the redirect dead-ends.

### Configure the app

Find the issuer — read it from the discovery document rather than assembling it
by hand, because a mismatched trailing path is the most common cause of a 401
that looks like nothing is wrong:

```bash
curl -s "https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0/.well-known/openid-configuration" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['issuer'])"
```

Then in `.env`:

```
# Backend: which tokens to accept
VISUALIZER_AZURE_AUTH_ISSUER_URI=<the issuer value printed above>
VISUALIZER_AZURE_AUTH_AUDIENCE=<application (client) ID>

# Frontend: compiled into the bundle by Vite
VITE_AZURE_CLIENT_ID=<application (client) ID>
VITE_AZURE_AUTHORITY=https://<subdomain>.ciamlogin.com/<tenant-id>
VITE_AZURE_API_SCOPE=api://<application (client) ID>/Trace.Run
```

Set the backend pair and the frontend trio **together**. Backend-only locks out a
frontend that has no way to obtain a token; frontend-only sends tokens nothing
checks.

The three `VITE_` values are not secrets. A browser application cannot hold a
client secret, which is exactly why this uses authorization code flow with PKCE.

### Verify

Because Vite inlines `import.meta.env` at build time, a rebuild is required —
restarting is not enough:

```bash
docker compose up --build -d
```

Backend logs should say:

```
API authentication enabled: validating tokens from https://...
```

Then:

1. `/login` shows **Continue with Microsoft** instead of the local form.
2. Signing up and back in lands you on `/app`.
3. `curl -i http://localhost/api/trace -X POST -H 'Content-Type: application/json' -d '{"language":"python","source":"x=1"}'`
   returns **401** — the API is genuinely closed, not just visually gated.
4. `curl -i http://localhost/api/health` still returns **200**, so the platform's
   health probe keeps working.

---

## Troubleshooting

**`AADSTS500011` / unknown authority** — the authority host is not in
`knownAuthorities`. `lib/auth.ts` derives it from the authority URL, so this
means `VITE_AZURE_AUTHORITY` is malformed. It must be a full URL with scheme.

**401 with a token that looks valid** — decode it at [jwt.ms](https://jwt.ms)
and compare `iss` against `VISUALIZER_AZURE_AUTH_ISSUER_URI` character for
character, then `aud` against `VISUALIZER_AZURE_AUTH_AUDIENCE`. These two
mismatches account for almost every case, and the audience one is silent if you
left the audience blank — the backend logs a warning at startup when you do.

**Frontend changes not taking effect** — Vite inlines env vars at build time.
`docker compose restart` will never pick them up; `docker compose build` is
required.

**Sign-in redirects then bounces back to `/login`** — usually a redirect URI
registered as **Web** rather than **SPA**. A Web platform issues no CORS headers
for the token endpoint, so the code exchange fails silently in the browser.

**`Trace archive read failed`** in the logs — the app is working as designed:
archive failures degrade to a cache miss and the run proceeds. Check the
connection string and that the account has not been deleted.

---

## What this demonstrates

For a résumé or an interview, the parts worth being able to talk about:

- **OAuth 2.0 / OIDC end to end** — authorization code flow with PKCE in the
  browser, a Spring Security resource server validating the resulting JWT
  against the tenant's JWKS, with explicit audience validation on top of issuer
  validation (`SecurityConfigTest` covers why issuer-only is not enough).
- **Content-addressed object storage** — the SHA-256 that already keyed the
  cache becomes the blob name, which makes writes idempotent, makes
  create-only uploads (`If-None-Match: *`) the correct semantics, and turns
  cache-sharing and link-sharing into the same feature.
- **Optional-dependency design** — every Azure integration degrades to the
  pre-Azure behaviour instead of failing, and the test suite runs with no cloud
  account. This is the part most worth defending in an interview: the archive
  cannot fail a run, and `TraceServiceTest` pins that.
- **Cost-aware engineering** — LRS over GRS for recomputable data, a lifecycle
  rule to cap storage, rate limiting extended to the endpoint that bills a
  storage transaction, and MSAL code-split out of the main bundle so a
  deployment without a tenant does not ship 270 kB it will never execute.
