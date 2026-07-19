# Capture Protocol

Capture is user-directed. The extension sends a request only after the user
clicks **Save Fragment** on a detected image.

## Candidate

```ts
type ImageCandidate = {
  id: string;
  src: string;
  currentSrc?: string;
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

## Request

```ts
type CaptureFragmentRequest = {
  type: "capture.fragment";
  requestId: string;
  frameId?: string | null;
  candidate: ImageCandidate;
  note?: string;
  tags?: string[];
  requestedAt: string;
  extensionVersion: string;
};
```

If `frameId` is missing or null, the native host saves into **Inbox**.

## Response

```ts
type CaptureFragmentResponse = {
  type: "capture.fragment.result";
  requestId: string;
  ok: boolean;
  fragmentId?: string;
  duplicateOfFragmentId?: string;
  thumbnailPath?: string;
  error?: { code: string; message: string };
};
```

## URL-First Save

The core chooses the image URL in this order:

1. `candidate.currentSrc`
2. `candidate.sourceUrl`
3. `candidate.src`

Only `http` and `https` URLs are accepted. Blob, data, file, and JavaScript URLs
are rejected in the MVP.

## Error Codes

- `native_host_unavailable`
- `native_host_empty_response`
- `invalid_capture_request`
- `capture_failed`
- `unknown_message_type`
- `invalid_message`
