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
- Derivatives are generated filenames under `thumbnails/` and `previews/`;
  raster derivatives are WebP, SVG tiers are PNG. Background regeneration
  commits new paths before the replaced files are deleted.

## URL Safety

Only `http` and `https` image URLs are accepted by URL-first capture. `file`,
`javascript`, `data`, and `blob` URLs are rejected in the MVP.

## Logging

Native host stdout is reserved for protocol messages. Diagnostics go to stderr
or log files. Avoid logging sensitive Source URLs unless needed for local
debugging.

## Static SVG support (0.0.8)

SVG originals are saved unchanged and are never injected as WebView markup.
The app displays Rust-rendered PNG derivatives (SVG tiers stay PNG even though
raster derivatives are WebP). Parsing/rendering runs in a killable subprocess;
this is not a claim of a complete OS sandbox.

Inputs are limited to 5 MiB of UTF-8 XML, 100,000 elements and depth 128.
DTD/entity declarations, processing instructions, scripts, animation,
foreignObject and unsupported elements are rejected. CSS is tokenized,
including escapes, to reject external style/font/image URLs. usvg's local-file
resolver is explicitly disabled. Only internal references and embedded base64
PNG/JPEG/WebP are supported; embedded image dimensions are limited to 32
megapixels in aggregate, including rendered repetitions. Each PNG output is
bounded to 4096 per edge. The parent kills and reaps workers after five seconds.

Byte/node/pixel limits constrain explicit allocations but do not establish a
strict process RSS ceiling for every complex SVG. Unsupported static features
produce errors instead of enabling arbitrary document resource loading.
Palettes and previews are local derived data; no image is sent to an AI or
third-party color-extraction service.
