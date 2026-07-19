# Security And Privacy

Fragment is local-first in the MVP.

- No cloud sync.
- No analytics.
- No third-party image processing APIs.
- No account/profile imports.
- No bulk extraction flows.

## Capture Boundaries

Capture happens only after the user selects a specific image and clicks
**Save Fragment**. The extension does not bypass authentication, platform
protections, rate limits, robots controls, or paywalls.

## Message Validation

The extension validates capture requests with Zod before sending them to the
native host. The host rejects unknown message types. Rust validates destination
Frames and URL schemes before saving.

## File Safety

- Extension input never controls filesystem destinations.
- Generated Fragment IDs are used as filenames.
- Database paths are stored relative to the Vault root.
- Relative paths are checked for traversal before resolving.
- Originals, thumbnails, and previews are stored on disk, not in SQLite.

## URL Safety

Only `http` and `https` image URLs are accepted by URL-first capture. `file`,
`javascript`, `data`, and `blob` URLs are rejected in the MVP.

## Logging

Native host stdout is reserved for protocol messages. Diagnostics go to stderr
or log files. Avoid logging sensitive Source URLs unless needed for local
debugging.
