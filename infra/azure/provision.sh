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
#     ./provision.sh teardown    # delete the resource group
#
# Storage is the only thing Azure provides here. Sign-in used to be, via an
# Entra app registration this script created; accounts are now self-hosted in
# the backend and need no cloud resource at all.
set -euo pipefail

RESOURCE_GROUP="${AZ_RESOURCE_GROUP:-visualizer}"
LOCATION="${AZ_LOCATION:-eastus}"
CONTAINER="${AZ_CONTAINER:-traces}"

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
  teardown) cmd_teardown ;;
  *)
    cat <<EOF
usage: $0 {storage|teardown}

  storage   resource group + storage account + container + lifecycle rule
  teardown  delete the resource group

See MIGRATION.md for the full sequence when moving to a new subscription.
EOF
    exit 1
    ;;
esac
