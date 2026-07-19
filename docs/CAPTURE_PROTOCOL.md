# Capture Protocol

Capture is user-directed. The extension sends a request only after the user
chooses one or more detected images and one or more destination Frames.

## Candidate

```ts
type ImageUrlCandidate = {
  url: string;
  source:
    | "src"
    | "currentSrc"
    | "srcset"
    | "sourceUrl"
    | "linkedImage"
    | "background"
    | "poster"
    | "openGraph";
  descriptor?: string;
  width?: number;
  density?: number;
};

type ImageCandidate = {
  id: string;
  src: string;
  currentSrc?: string;
  imageUrls?: ImageUrlCandidate[];
  pageUrl: string;
  sourceUrl?: string;
  siteName?: string;
  alt?: string;
  title?: string;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  rect: { x: number; y: number; width: number; height: number };
  source: "pinterest" | "instagram" | "google_images" | "generic";
};
```

`imageUrls` carries ranked-source metadata collected by the detector. Legacy
clients may omit it and rely on `currentSrc`, `sourceUrl`, and `src`.

## Request

```ts
type CaptureFragmentRequest = {
  type: "capture.fragment";
  requestId: string;
  frameId?: string | null; // legacy single-Frame fallback
  frameIds?: string[]; // preferred v0.0.3 destination field
  candidate: ImageCandidate;
  note?: string;
  tags?: string[];
  requestedAt: string;
  extensionVersion: string;
};
```

Destination resolution is deterministic:

1. Use non-empty `frameIds` when provided.
2. Otherwise use `frameId` when provided.
3. Otherwise use the system Inbox.
4. Remove repeated IDs while preserving order and validate every Frame.

New clients should send `frameIds`. `frameId` remains for compatibility during
the v0.0.3 transition.

## Response

```ts
type CaptureFragmentResponse = {
  type: "capture.fragment.result";
  requestId: string;
  ok: boolean;
  fragmentId?: string; // first created membership, compatibility field
  fragmentIds?: string[]; // all created memberships
  duplicateOfFragmentId?: string; // first existing membership
  duplicateOfFragmentIds?: string[]; // all existing memberships
  thumbnailPath?: string;
  error?: { code: string; message: string };
};
```

`fragmentIds` and `duplicateOfFragmentIds` are authoritative for multi-Frame
requests. The singular fields mirror the first array element for older clients.
A successful request can contain created IDs, duplicate IDs, or both.

## Shared-asset behavior

The core downloads and hashes one selected candidate, stores one asset, and
creates one Fragment membership per destination Frame. If the same asset is
already active in a destination Frame, the response reports that membership as
a duplicate instead of creating another one.

The v0.0.3 target makes all memberships for one request transactional. Until
that work lands, clients must use `requestId` for diagnostics and must not
assume a retry can safely duplicate the whole request.

## URL ranking and fallback

The core builds a ranked, deduplicated URL list from `imageUrls`, `currentSrc`,
`sourceUrl`, and `src`. Only `http` and `https` URLs are accepted. Candidates
are attempted in score order, and a failed download or invalid image payload
falls through to the next URL.

Blob, data, file, and JavaScript URLs are rejected by the native URL-first flow.

## Error codes

- `native_host_unavailable`
- `native_host_empty_response`
- `invalid_capture_request`
- `capture_failed`
- `unknown_message_type`
- `invalid_message`

Errors are transport-safe and intentionally omit arbitrary filesystem paths.
