# Native Messaging

Host name:

```txt
com.autoscale.fragment
```

The native host reads Chrome Native Messaging messages from stdin and writes
responses to stdout. Diagnostics go to stderr or a log file, never stdout.

Each message is:

```txt
4-byte little-endian payload length
UTF-8 JSON payload
```

## Supported requests

```ts
type NativeRequest =
  | { type: "ping"; requestId: string }
  | { type: "frames.list"; requestId: string }
  | CaptureFragmentRequest;
```

`CaptureFragmentRequest` supports preferred `frameIds: string[]` destinations
and the legacy `frameId` fallback. See `CAPTURE_PROTOCOL.md` for exact capture
and shared-asset semantics.

## Supported responses

```ts
type NativeResponse =
  | {
      type: "pong";
      requestId: string;
      ok: true;
      app: "Fragment";
      version: string;
    }
  | { type: "frames.list.result"; requestId: string; ok: true; frames: Frame[] }
  | CaptureFragmentResponse
  | {
      type: "error";
      requestId?: string;
      ok: false;
      error: { code: string; message: string };
    };
```

Every response to a valid request must echo its `requestId`. The extension must
reject mismatched IDs rather than associating a stale response with a newer UI
action.

## Version compatibility

- The root, npm workspaces, Cargo packages, Tauri app, and extension manifests
  use application version `0.0.3` while this release is in development.
- `extensionVersion` reports the sender build.
- `pong.version` reports the native host build.
- Neither field is currently a protocol version.
- Explicit protocol negotiation and one-version backward compatibility remain
  v0.0.3 release work; any added field must be optional for the previous client.

## Development manifest

```json
{
  "name": "com.autoscale.fragment",
  "description": "Fragment native messaging host",
  "path": "/absolute/path/to/fragment-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://REPLACE_WITH_EXTENSION_ID/"]
}
```

Install for local development:

```bash
scripts/install-native-host-macos.sh <chrome-extension-id>
```

Without an explicit host path, the installer checks the host bundled in
`Fragment.app` first, then release and debug workspace binaries. Production
builds bundle `fragment-host` at
`Fragment.app/Contents/Resources/fragment-host` so the manifest does not depend
on a repository path.

The development manifest is written to:

```txt
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.autoscale.fragment.json
```

This script points at a local build and is not a production installer. The
v0.0.3 distribution target is a signed host bundled at a stable path inside
`Fragment.app`, with an install/repair action that changes the Chrome manifest
only after the bundled host answers `ping`.

## Debugging

```bash
cargo test -p fragment-host
pnpm smoke:native-host
```

If Chrome cannot connect, verify:

- The manifest exists at Chrome's expected path.
- `path` points to an executable host.
- `allowed_origins` contains the exact loaded extension ID.
- The host writes no diagnostics to stdout.
- The host and extension report compatible application versions.
