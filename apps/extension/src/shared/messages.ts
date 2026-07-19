export type ContentMessage =
  | { type: "fragment.capture.toggle" }
  | { type: "fragment.capture.disable" };

export type BackgroundMessage =
  | { type: "fragment.frames.list"; requestId: string }
  | { type: "fragment.capture.save"; payload: unknown };

export type BackgroundReply =
  | { ok: true; payload: unknown }
  | { ok: false; error: { code: string; message: string } };

export function requestId(prefix = "fragment"): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
