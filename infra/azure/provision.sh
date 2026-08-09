#!/usr/bin/env bash
#
# Provision the Visualizer's Azure resources, and print the environment
# variables they produce.
#
# Written to be run again on a *new* subscription when an old one expires --
# see MIGRATION.md. Every step is idempotent, so a re-run against a
# half-provisioned subscription finishes the job rather than erroring.
#
#     ./provision.sh storage     # Blob Storage for the trace archive
#     ./provision.sh app         # Entra app registration for sign-in
#     ./provision.sh teardown    # delete the resource group
#
# Two things this deliberately does NOT create, because both are portal-only:
# the external tenant itself, and the sign-up user flow. MIGRATION.md covers
# them. Everything after that point is here.
set -euo pipefail

RESOURCE_GROUP="${AZ_RESOURCE_GROUP:-visualizer}"
LOCATION="${AZ_LOCATION:-eastus}"
CONTAINER="${AZ_CONTAINER:-traces}"
APP_NAME="${AZ_APP_NAME:-Visualizer}"

# Redirect URIs for the SPA. Localhost for development, plus wherever the app
# is deployed. Override to match your own deployment:
#
#     AZ_REDIRECT_URIS="http://localhost:5173 https://yourapp.onrender.com" ./provision.sh app
#
# Origins only, no paths -- lib/auth.ts configures MSAL with
# `redirectUri: window.location.origin`, and Entra matches these exactly.
REDIRECT_URIS="${AZ_REDIRECT_URIS:-http://localhost:5173 https://visualizer-igxk.onrender.com}"

# Traces are recomputable by re-running the code, so storing them forever is
# paying to keep something you can regenerate. 0 disables expiry.
RETENTION_DAYS="${AZ_RETENTION_DAYS:-90}"

die() { echo "error: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

require_az() {
  command -v az >/dev/null || die "Azure CLI not found. https://aka.ms/InstallAzureCLI"
  az account show >/dev/null 2>&1 || die "Not signed in. Run: az login"
}

# ---------------------------------------------------------------------------
# Storage: the durable tier behind the in-memory trace cache.
# ---------------------------------------------------------------------------
cmd_storage() {
  require_az

  # The account name becomes part of a public hostname, so it must be globally
  # unique and lowercase alphanumeric, 3-24 chars. Pass AZ_STORAGE_ACCOUNT to
  # reuse an existing one; otherwise a random suffix avoids a name collision.
  local account="${AZ_STORAGE_ACCOUNT:-viztraces$RANDOM$RANDOM}"
  account=$(echo "$account" | tr '[:upper:]' '[:lower:]' | cut -c1-24)

  step "Resource group '$RESOURCE_GROUP'"
  # Reuse an existing group rather than re-creating it. A group's location is
  # fixed at creation, and `az group create` errors rather than no-oping when
  # given a different one -- so re-running with a changed AZ_LOCATION (which is
  # exactly what you do when a region turns out to be disallowed) would fail on
  # the group before ever reaching the resource that actually needs the new
  # region. The location is only metadata anyway; resources inside a group can
  # live anywhere.
  local rg_location
  rg_location=$(az group show --name "$RESOURCE_GROUP" \
                  --query location --output tsv 2>/dev/null || echo "")
  if [ -n "$rg_location" ]; then
    echo "    exists in '$rg_location', reusing"
    [ "$rg_location" = "$LOCATION" ] \
      || echo "    (storage account will be created in '$LOCATION')"
  else
    echo "    creating in '$LOCATION'"
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
  fi

  # A fresh subscription often has Microsoft.Storage unregistered, and the
  # failure is thoroughly misleading: creating the resource group succeeds
  # (that is Microsoft.Resources, always registered) and then the storage
  # account fails with "SubscriptionNotFound" -- because the Storage provider,
  # not ARM, is the thing that has never heard of this subscription. Registering
  # is idempotent and takes a minute or two the first time.
  step "Resource provider Microsoft.Storage"
  local state
  state=$(az provider show --namespace Microsoft.Storage \
            --query registrationState --output tsv 2>/dev/null || echo "Unknown")
  if [ "$state" = "Registered" ]; then
    echo "    already registered"
  else
    echo "    state is '$state', registering (this can take a couple of minutes)"
    az provider register --namespace Microsoft.Storage --wait
    echo "    registered"
  fi

  step "Storage account '$account'"
  if az storage account show --name "$account" --resource-group "$RESOURCE_GROUP" \
       --output none 2>/dev/null; then
    echo "    already exists, reusing"
  else
    # Standard_LRS, not GRS: this data is a cache of things that can be
    # recomputed, so paying to replicate it across regions buys durability the
    # data does not need. --allow-blob-public-access false because reads go
    # through the backend, which is where rate limiting and auth live; public
    # blobs would route around both.
    az storage account create \
      --name "$account" \
      --resource-group "$RESOURCE_GROUP" \
      --location "$LOCATION" \
      --sku Standard_LRS \
      --kind StorageV2 \
      --access-tier Hot \
      --allow-blob-public-access false \
      --min-tls-version TLS1_2 \
      --output none
  fi

  step "Container '$CONTAINER'"
  local conn
  conn=$(az storage account show-connection-string \
           --name "$account" --resource-group "$RESOURCE_GROUP" \
           --query connectionString --output tsv)
  # The app creates this on first write too, so this is belt-and-braces for a
  # credential that is scoped to an existing container.
  az storage container create \
    --name "$CONTAINER" --connection-string "$conn" --output none

  if [ "$RETENTION_DAYS" -gt 0 ]; then
    step "Lifecycle rule: delete blobs after $RETENTION_DAYS days"
    az storage account management-policy create \
      --account-name "$account" --resource-group "$RESOURCE_GROUP" \
      --policy "$(cat <<JSON
{"rules":[{"enabled":true,"name":"expire-traces","type":"Lifecycle",
 "definition":{"filters":{"blobTypes":["blockBlob"]},
 "actions":{"baseBlob":{"delete":{"daysAfterModificationGreaterThan":$RETENTION_DAYS}}}}}]}
JSON
)" --output none
    echo "    a share link older than $RETENTION_DAYS days goes cold, which the"
    echo "    frontend already handles by offering the editor"
  fi

  cat <<EOF

--- storage done -------------------------------------------------------------

Set these on the backend (Render dashboard, or .env locally):

AZURE_STORAGE_CONNECTION_STRING=$conn
AZURE_STORAGE_CONTAINER=$CONTAINER

The connection string carries the account key. Never commit it.
Account name, for a later re-run:  AZ_STORAGE_ACCOUNT=$account
EOF
}

# ---------------------------------------------------------------------------
# Entra: the app registration that sign-in validates against.
#
# Run AFTER creating the tenant, and while logged into it:
#     az login --tenant <tenant-id> --allow-no-subscriptions
# ---------------------------------------------------------------------------
cmd_app() {
  require_az

  local tenant
  tenant=$(az account show --query tenantId --output tsv)
  echo "Registering in tenant: $tenant"
  echo "(If that is not the new tenant, stop and re-run: az login --tenant <id> --allow-no-subscriptions)"

  step "App registration '$APP_NAME'"
  local app_id
  app_id=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" --output tsv 2>/dev/null || true)

  if [ -n "$app_id" ] && [ "$app_id" != "null" ]; then
    echo "    already exists, reusing $app_id"
  else
    # AzureADMyOrg: external tenants only support single-tenant registrations.
    app_id=$(az ad app create --display-name "$APP_NAME" \
               --sign-in-audience AzureADMyOrg \
               --query appId --output tsv)
    echo "    created $app_id"
  fi

  local object_id
  object_id=$(az ad app show --id "$app_id" --query id --output tsv)

  step "SPA redirect URIs"
  # Must be the SPA platform, not Web. A Web platform issues no CORS headers on
  # the token endpoint, so the PKCE code exchange fails silently in the browser
  # -- which presents as a sign-in that loops back to /login for no clear reason.
  #
  # Split explicitly rather than leaning on unquoted word splitting: that is a
  # bash behaviour, and this file gets read and pasted from by people running
  # zsh, where the same expression yields one URI containing a space.
  local -a uris
  read -ra uris <<< "$REDIRECT_URIS"
  [ ${#uris[@]} -gt 0 ] || die "AZ_REDIRECT_URIS is empty"

  local uris_json
  uris_json=$(printf '%s\n' "${uris[@]}" \
    | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
  az rest --method PATCH \
    --url "https://graph.microsoft.com/v1.0/applications/$object_id" \
    --headers "Content-Type=application/json" \
    --body "{\"spa\":{\"redirectUris\":$uris_json}}" --output none
  printf '    %s\n' "${uris[@]}"

  step "Exposing the API scope"
  # A stable scope id keeps re-runs idempotent: Entra rejects a PATCH that
  # changes an existing scope's id, and a random one each run would do exactly
  # that. Derived from the app id so it is deterministic per registration.
  local scope_id
  scope_id=$(python3 -c "
import uuid
print(uuid.uuid5(uuid.NAMESPACE_URL, 'visualizer-trace-run-$app_id'))
")
  az rest --method PATCH \
    --url "https://graph.microsoft.com/v1.0/applications/$object_id" \
    --headers "Content-Type=application/json" \
    --body "$(cat <<JSON
{"identifierUris":["api://$app_id"],
 "api":{"oauth2PermissionScopes":[{
   "id":"$scope_id","value":"Trace.Run","type":"User","isEnabled":true,
   "adminConsentDisplayName":"Run and replay traces",
   "adminConsentDescription":"Allows the signed-in user to execute snippets and read their traces.",
   "userConsentDisplayName":"Run and replay traces",
   "userConsentDescription":"Lets you execute snippets and read your traces."
 }]}}
JSON
)" --output none
  echo "    api://$app_id/Trace.Run"

  # Ensure a service principal exists, or admin consent has nothing to grant.
  az ad sp show --id "$app_id" --output none 2>/dev/null \
    || az ad sp create --id "$app_id" --output none

  local issuer
  issuer=$(curl -fsS "https://login.microsoftonline.com/$tenant/v2.0/.well-known/openid-configuration" \
             | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])' 2>/dev/null || echo "")

  cat <<EOF

--- app registration done ----------------------------------------------------

STILL TO DO IN THE PORTAL (neither is scriptable):

  1. API permissions -> Add a permission -> My APIs -> $APP_NAME -> Trace.Run,
     then "Grant admin consent". NOT optional in an external tenant: users
     cannot consent for themselves, so skipping this fails every sign-in at the
     consent screen.
  2. External Identities -> User flows -> New user flow (external tenants only).
     Enable email + password, and associate this application. Without it the
     tenant has no sign-up experience and the redirect dead-ends.

Then set these:

  Backend
    VISUALIZER_AZURE_AUTH_AUDIENCE=$app_id
EOF

  if [ -n "$issuer" ]; then
    echo "    VISUALIZER_AZURE_AUTH_ISSUER_URI=$issuer"
  else
    echo "    VISUALIZER_AZURE_AUTH_ISSUER_URI=<see below>"
  fi

  cat <<EOF

  Frontend (compiled into the bundle -- a redeploy, not a restart)
    VITE_AZURE_CLIENT_ID=$app_id
    VITE_AZURE_API_SCOPE=api://$app_id/Trace.Run
    VITE_AZURE_AUTHORITY=<see below>

AUTHORITY / ISSUER depend on the tenant type:

  External ID tenant (preferred -- anyone can sign up):
    authority  https://<subdomain>.ciamlogin.com/$tenant
    issuer     read it from the discovery document, do not hand-assemble it:
      curl -s "https://<subdomain>.ciamlogin.com/$tenant/v2.0/.well-known/openid-configuration" \\
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])'

  Workforce tenant (fallback when you cannot create an external tenant):
    authority  https://login.microsoftonline.com/$tenant
    issuer     ${issuer:-https://login.microsoftonline.com/$tenant/v2.0}

A mismatched issuer is the single most common cause of a 401 that looks like
nothing is wrong, which is why it is read rather than constructed.
EOF
}

# ---------------------------------------------------------------------------
cmd_teardown() {
  require_az
  echo "This deletes resource group '$RESOURCE_GROUP' and everything in it."
  echo "Trace blobs are recomputable, so nothing unrecoverable is lost -- but"
  echo "existing share links stop resolving until someone re-runs that code."
  read -r -p "Type the resource group name to confirm: " confirm
  [ "$confirm" = "$RESOURCE_GROUP" ] || die "aborted"
  az group delete --name "$RESOURCE_GROUP" --yes --no-wait
  echo "Deletion started. The app keeps working without it."
  echo "Remember to clear AZURE_STORAGE_CONNECTION_STRING from the deployment."
}

case "${1:-}" in
  storage)  cmd_storage ;;
  app)      cmd_app ;;
  teardown) cmd_teardown ;;
  *)
    cat <<EOF
usage: $0 {storage|app|teardown}

  storage   resource group + storage account + container + lifecycle rule
  app       Entra app registration + SPA redirect URIs + exposed API scope
  teardown  delete the resource group

See MIGRATION.md for the full sequence when moving to a new subscription.
EOF
    exit 1
    ;;
esac
