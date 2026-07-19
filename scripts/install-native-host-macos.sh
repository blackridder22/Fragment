#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_ID="${1:-}"
HOST_PATH="${2:-$ROOT_DIR/target/debug/fragment-host}"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/com.autoscale.fragment.json"

if [[ -z "$EXTENSION_ID" ]]; then
  echo "Usage: scripts/install-native-host-macos.sh <chrome-extension-id> [path-to-fragment-host]" >&2
  exit 1
fi

if [[ ! -x "$HOST_PATH" ]]; then
  echo "Building fragment-host because no executable was found at $HOST_PATH"
  cargo build -p fragment-host --bin fragment-host --manifest-path "$ROOT_DIR/Cargo.toml"
fi

HOST_PATH="$(cd "$(dirname "$HOST_PATH")" && pwd)/$(basename "$HOST_PATH")"
mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_PATH" <<JSON
{
  "name": "com.autoscale.fragment",
  "description": "Fragment native messaging host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
JSON

echo "Installed Fragment native messaging host manifest:"
echo "$MANIFEST_PATH"
echo
echo "Verify in Chrome by loading apps/extension/dist as an unpacked extension, then click the Fragment toolbar icon on an image-heavy page."
