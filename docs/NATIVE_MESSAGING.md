# Native Messaging

Host name:

```txt
com.autoscale.fragment
```

The host reads Chrome Native Messaging messages from stdin and writes responses
to stdout. Diagnostics go to stderr only.

Each message is:

```txt
4-byte little-endian length
UTF-8 JSON payload
```

## Supported Requests

```ts
type NativeRequest =
  | { type: "ping"; requestId: string }
  | { type: "frames.list"; requestId: string }
  | CaptureFragmentRequest;
```

## Manifest

Example:

```json
{
  "name": "com.autoscale.fragment",
  "description": "Fragment native messaging host",
  "path": "/absolute/path/to/fragment-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://REPLACE_WITH_EXTENSION_ID/"
  ]
}
```

Install for local development:

```bash
scripts/install-native-host-macos.sh <chrome-extension-id>
```

Manifest destination:

```txt
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.autoscale.fragment.json
```

## Debugging

Run the host tests:

```bash
cargo test -p fragment-host
```

If Chrome cannot connect, verify:

- The manifest path exists.
- The `path` points to an executable `fragment-host`.
- The extension ID matches the loaded unpacked extension.
- Host logs are not written to stdout.
