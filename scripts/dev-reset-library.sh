#!/usr/bin/env bash
set -euo pipefail

VAULT_DIR="${FRAGMENT_APP_DATA_DIR:-$HOME/Library/Application Support/Fragment}"

echo "This will remove the local Fragment development Vault at:"
echo "$VAULT_DIR"
read -r -p "Type RESET to continue: " CONFIRM

if [[ "$CONFIRM" != "RESET" ]]; then
  echo "Reset cancelled."
  exit 0
fi

rm -rf "$VAULT_DIR"
echo "Removed $VAULT_DIR"
