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
  | {
      type: "ping";
      requestId: string;
      protocolVersion?: number;
      minimumProtocolVersion?: number;
    }
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
      protocolVersion: number;
      minimumProtocolVersion: number;
      compatible: boolean;
      capabilities?: string[]; // v0.0.8: ["svg", "color_palette"]
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
  use the current synchronized application version (`0.0.8` for this release).
- `extensionVersion` reports the sender build.
- `pong.version` reports the native host build.
- Neither application-version field is the native protocol version.
- The current protocol is version `2` and its minimum compatible version is
  `1`. Ping requests and responses exchange `protocolVersion` and
  `minimumProtocolVersion`; the handshake succeeds only when the client and
  host ranges overlap.
- Protocol fields remain optional on incoming messages so a current host can
  answer a version-1 client and a current extension can evaluate a legacy pong.

## Chrome manifest setup

```json
{
  "name": "com.autoscale.fragment",
  "description": "Fragment native messaging host",
  "path": "/absolute/path/to/fragment-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://REPLACE_WITH_EXTENSION_ID/"]
}
```

On macOS, Fragment Desktop makes a best-effort setup attempt at app startup. It
creates or repairs Chrome's manifest so `path` points to the bundled host at
`Fragment.app/Contents/Resources/fragment-host` and `allowed_origins` contains
the packaged extension origin. A setup failure is logged and does not prevent
the app from launching; Settings can report the current native-host state.

The Settings status is a live readiness check, not a manifest-presence label.
Fragment verifies the exact manifest origin and bundled host path, confirms the
host is executable, launches it, and completes a bounded ping handshake. Ready
requires matching Fragment application versions and an overlapping native
protocol range.

Use the script as a manual repair or local-development fallback:

```bash
scripts/install-native-host-macos.sh <chrome-extension-id>
```

Without an explicit host path, the installer checks the host bundled in
`Fragment.app` first, then release and debug workspace binaries. Packaged
builds bundle `fragment-host` at
`Fragment.app/Contents/Resources/fragment-host` so the manifest does not depend
on a repository path.

The development manifest is written to:

```txt
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.autoscale.fragment.json
```

The script is a manual fallback, not the normal packaged-app setup path. The
v0.0.7 local beta target keeps the host bundled at a stable path inside
`Fragment.app`; startup setup or manual repair must never point Chrome at a
temporary or user-selected executable.

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

## Private SVG worker and local verification

The same bundled binary supports `--render-svg` before normal host initialization.
It reads one private JSON request over stdin and emits one private JSON result;
these messages are not Chrome length-prefixed messages and are never exposed as
an extension operation. The parent chooses staging paths and permitted tiers.
The worker opens no Vault database. Desktop resolves it from app resources;
a native host starts its own executable in worker mode.

`pnpm release:local` verifies both normal version/protocol/capability negotiation
and the packaged private worker's PNG dimensions, original-byte preservation
and absence of database initialization.

`node scripts/media-host-smoke.mjs [host-path] [report-path]` uses a temporary
Vault, a loopback test server and the real executable. It requires SQLite CLI;
on macOS it also probes/reaps its own test child using pgrep/ps. It verifies
SVG/PNG persistence, >8-second response, queued ping IDs, renderer crash recovery
and a restarted host. This automated check is separate from real Chrome toolbar,
Frame-picker, permission, connection and desktop-focus verification.
