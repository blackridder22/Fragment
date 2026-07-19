#!/usr/bin/env bash
set -euo pipefail

MANIFEST_PATH="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.autoscale.fragment.json"

if [[ -f "$MANIFEST_PATH" ]]; then
  rm "$MANIFEST_PATH"
  echo "Removed $MANIFEST_PATH"
else
  echo "No Fragment native messaging host manifest found at $MANIFEST_PATH"
fi
