import { z } from "zod";
import type { Frame, ImageCandidate } from "./domain";

export const frameSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const imageCandidateSchema = z.object({
  id: z.string(),
  src: z.string(),
  currentSrc: z.string().optional(),
  imageUrls: z
    .array(
      z.object({
        url: z.string(),
        source: z.enum([
          "src",
          "currentSrc",
          "srcset",
          "sourceUrl",
          "linkedImage",
          "background",
          "poster",
          "openGraph",
        ]),
        descriptor: z.string().optional(),
        width: z.number().optional(),
        density: z.number().optional(),
      }),
    )
    .optional(),
  pageUrl: z.string(),
  sourceUrl: z.string().optional(),
  siteName: z.string().optional(),
  alt: z.string().optional(),
  title: z.string().optional(),
  width: z.number(),
  height: z.number(),
  naturalWidth: z.number().optional(),
  naturalHeight: z.number().optional(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  source: z.enum(["pinterest", "instagram", "google_images", "generic"]),
});

export const captureFragmentRequestSchema = z.object({
  type: z.literal("capture.fragment"),
  requestId: z.string(),
  frameId: z.string().nullable().optional(),
  frameIds: z.array(z.string()).optional(),
  candidate: imageCandidateSchema,
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  requestedAt: z.string(),
  extensionVersion: z.string(),
});

export type CaptureFragmentRequest = {
  type: "capture.fragment";
  requestId: string;
  frameId?: string | null;
  frameIds?: string[];
  candidate: ImageCandidate;
  note?: string;
  tags?: string[];
  requestedAt: string;
  extensionVersion: string;
};

export type CaptureFragmentResponse = {
  type: "capture.fragment.result";
  requestId: string;
  ok: boolean;
  fragmentId?: string;
  fragmentIds?: string[];
  duplicateOfFragmentId?: string;
  duplicateOfFragmentIds?: string[];
  thumbnailPath?: string;
  error?: {
    code: string;
    message: string;
  };
};

export type NativeRequest =
  | { type: "ping"; requestId: string }
  | { type: "frames.list"; requestId: string }
  | CaptureFragmentRequest;

export type NativeResponse =
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

export const nativeRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), requestId: z.string() }),
  z.object({ type: z.literal("frames.list"), requestId: z.string() }),
  captureFragmentRequestSchema,
]);
