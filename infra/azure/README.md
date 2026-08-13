# Azure integration

One optional integration:

| | What it adds | Where it plugs in |
|---|---|---|
| **Blob Storage** | Traces outlive a restart, so a shared link keeps resolving | `TraceArchive` behind the Caffeine cache |

**It is not required.** With every variable unset the app is byte-for-byte the
one that ran before Azure existed: traces are cached in memory and no Azure SDK
code path is reached. That is a supported configuration, not a degraded one —
`docker compose up`, `mvn test` and a laptop with no Azure account all depend
on it.

> **Sign-in used to be here too, and deliberately is not any more.**
>
> Authentication was Entra External ID, which meant the SPA and the API each had
> to be told about the tenant separately — the SPA at *build* time, because Vite
> inlines `import.meta.env`. Configure one without the other and you got a
> sign-in screen that worked followed by a 401 on every request, with signing in
> again the one action that could not possibly help. A lapsed tenant did the
> same thing while `/api/health` stayed green, so nothing alerted.
>
> Accounts are now self-hosted in `com.visualizer.auth`: the API stores users
> and signs its own tokens. Nothing about it is configurable from the browser,
> so the two halves cannot disagree, and no Azure subscription can take sign-in
> down with it. See the Accounts section of the root [README](../../README.md).

**Setting this up on a new subscription?** [`provision.sh`](provision.sh) does
the mechanical parts, and [`MIGRATION.md`](MIGRATION.md) is the step-by-step
runbook for moving from an expiring subscription to a fresh one. This document
explains what each piece is and why; that one is the sequence to follow.

---

## Cost

Chosen to sit inside always-free limits at this project's scale, not to be paid
for out of trial credit:

- **Blob Storage** bills for stored bytes and transactions. Traces are small
  JSON documents and, being content-addressed, are written once and never
  updated — so a re-run of the same snippet is not a billed write. Expect
  cents per month.

Prices and free-tier limits change, so confirm against
[Azure pricing](https://azure.microsoft.com/pricing/) rather than trusting the
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
well under a dollar a month: a few megabytes of trace blobs bills fractions of a
cent once the 12-month storage grant ends (that grant runs from your original
sign-up date, so upgrading does not extend it). Choose this if you want shared
links on the live demo to keep resolving.

**Let it lapse and fall back.** The app is built to run with no Azure at all, so
the deployment keeps working — in-memory cache, no errors. You lose durable
share links, and the integration lives on in the code and in this document,
which is what a reviewer actually reads. Costs nothing.

> **Letting it lapse is now safe in every direction, which it once was not.**
>
> Storage failing is safe by design: the archive degrades to a cache miss and a
> run still succeeds. Authentication used to be the exception — a lapsed tenant
> with the issuer still configured 401ed every `/api/**` call while
> `/api/health` kept the platform's health check green, so the app was bricked
> and looked fine. Accounts no longer depend on Azure at all, so there is
> nothing left here that can take sign-in down.
>
> `AZURE_STORAGE_CONNECTION_STRING` is safe to leave set, though clearing it
> saves a pointless failing call per cache miss.

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

## Troubleshooting

**`Trace archive read failed`** in the logs — the app is working as designed:
archive failures degrade to a cache miss and the run proceeds. Check the
connection string and that the account has not been deleted.

---

## What this demonstrates

For a résumé or an interview, the parts worth being able to talk about:

- **Content-addressed object storage** — the SHA-256 that already keyed the
  cache becomes the blob name, which makes writes idempotent, makes
  create-only uploads (`If-None-Match: *`) the correct semantics, and turns
  cache-sharing and link-sharing into the same feature.
- **Optional-dependency design** — the Azure integration degrades to the
  pre-Azure behaviour instead of failing, and the test suite runs with no cloud
  account. This is the part most worth defending in an interview: the archive
  cannot fail a run, and `TraceServiceTest` pins that.
- **Cost-aware engineering** — LRS over GRS for recomputable data, a lifecycle
  rule to cap storage, and rate limiting extended to the endpoint that bills a
  storage transaction.
- **Knowing when to stop depending on a cloud** — sign-in was here and was
  removed, because a managed identity provider bought this app nothing it could
  not do itself and introduced a failure mode where one misconfigured half
  locked every user out of a working backend. That decision, and the trade it
  accepts (no email verification, no social login), is the most honest thing in
  this document.
