import { frameSchema } from "@fragment/shared";
import { z } from "zod";
import type { NativeRequest, NativeResponse } from "../shared/types";

export const HOST_NAME = "com.autoscale.fragment";
export const NATIVE_PROTOCOL_VERSION = 2;
export const MINIMUM_NATIVE_PROTOCOL_VERSION = 1;

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 4_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 4;

const nativeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const nativeResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pong"),
    requestId: z.string(),
    ok: z.literal(true),
    app: z.literal("Fragment"),
    version: z.string(),
    protocolVersion: z.number().int().positive().optional(),
    minimumProtocolVersion: z.number().int().positive().optional(),
    compatible: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("frames.list.result"),
    requestId: z.string(),
    ok: z.literal(true),
    frames: z.array(frameSchema),
  }),
  z.object({
    type: z.literal("capture.fragment.result"),
    requestId: z.string(),
    ok: z.boolean(),
    fragmentId: z.string().nullish().transform(nullToUndefined),
    fragmentIds: z.array(z.string()).nullish().transform(nullToUndefined),
    duplicateOfFragmentId: z.string().nullish().transform(nullToUndefined),
    duplicateOfFragmentIds: z
      .array(z.string())
      .nullish()
      .transform(nullToUndefined),
    thumbnailPath: z.string().nullish().transform(nullToUndefined),
    error: nativeErrorSchema.nullish().transform(nullToUndefined),
  }),
  z.object({
    type: z.literal("error"),
    requestId: z.string(),
    ok: z.literal(false),
    error: nativeErrorSchema,
  }),
]);

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

type ParsedNativeResponse = z.infer<typeof nativeResponseSchema>;
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

type ListenerEvent<TListener extends (...args: never[]) => void> = {
  addListener(listener: TListener): void;
  removeListener?(listener: TListener): void;
};

export type NativePortLike = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: ListenerEvent<(message: unknown) => void>;
  onDisconnect: ListenerEvent<() => void>;
};

export type NativeConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unavailable";

export type NativeConnectionIssue = {
  code: string;
  message: string;
};

export type NativeConnectionState = {
  status: NativeConnectionStatus;
  attempt: number;
  protocolVersion?: number;
  hostVersion?: string;
  error?: NativeConnectionIssue;
};

export class NativeClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeClientError";
  }
}

type PendingRequest = {
  request: NativeRequest;
  resolve: (response: NativeResponse) => void;
  reject: (error: NativeClientError) => void;
  timer: TimerHandle;
  sent: boolean;
};

type Handshake = {
  requestId: string;
  timer: TimerHandle;
};

export type NativePortManagerOptions = {
  connectNative?: (hostName: string) => NativePortLike;
  getLastErrorMessage?: () => string | undefined;
  requestTimeoutMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  maxReconnectAttempts?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

export class NativePortManager {
  private readonly connectNative: (hostName: string) => NativePortLike;
  private readonly getLastErrorMessage: () => string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => TimerHandle;
  private readonly clearTimer: (timer: TimerHandle) => void;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly stateListeners = new Set<
    (state: NativeConnectionState) => void
  >();
  private port: NativePortLike | undefined;
  private handshake: Handshake | undefined;
  private reconnectTimer: TimerHandle | undefined;
  private reconnectAttempts = 0;
  private hasConnected = false;
  private disposed = false;
  private handshakeSequence = 0;
  private state: NativeConnectionState = { status: "idle", attempt: 0 };

  constructor(options: NativePortManagerOptions = {}) {
    this.connectNative =
      options.connectNative ??
      ((hostName) =>
        chrome.runtime.connectNative(hostName) as unknown as NativePortLike);
    this.getLastErrorMessage =
      options.getLastErrorMessage ??
      (() => chrome.runtime.lastError?.message);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.reconnectBaseDelayMs =
      options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    this.reconnectMaxDelayMs =
      options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.setTimer =
      options.setTimer ??
      ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimer =
      options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
  }

  request(request: NativeRequest): Promise<NativeResponse> {
    if (this.disposed) {
      return Promise.reject(
        new NativeClientError(
          "native_client_disposed",
          "Fragment native connection is closed",
        ),
      );
    }
    if (this.pending.has(request.requestId)) {
      return Promise.reject(
        new NativeClientError(
          "duplicate_request_id",
          `Native request ID ${request.requestId} is already pending`,
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.handleRequestTimeout(request.requestId);
      }, this.requestTimeoutMs);
      this.pending.set(request.requestId, {
        request,
        resolve,
        reject,
        timer,
        sent: false,
      });

      if (this.state.status === "connected" && this.port) {
        this.postPendingRequest(this.pending.get(request.requestId));
      } else {
        if (this.state.status === "unavailable") {
          this.reconnectAttempts = 0;
        }
        this.ensureConnected();
      }
    });
  }

  connectionState(): NativeConnectionState {
    return { ...this.state };
  }

  subscribe(
    listener: (state: NativeConnectionState) => void,
  ): () => void {
    this.stateListeners.add(listener);
    listener(this.connectionState());
    return () => this.stateListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.reconnectTimer) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.clearHandshake();
    const port = this.port;
    this.port = undefined;
    port?.disconnect();
    this.rejectAll(
      new NativeClientError(
        "native_client_disposed",
        "Fragment native connection is closed",
      ),
    );
    this.updateState({ status: "idle", attempt: 0 });
  }

  private ensureConnected(): void {
    if (
      this.disposed ||
      this.port ||
      this.reconnectTimer ||
      this.state.status === "connecting"
    ) {
      return;
    }
    this.connect();
  }

  private connect(): void {
    const status: NativeConnectionStatus =
      this.hasConnected || this.reconnectAttempts > 0
        ? "reconnecting"
        : "connecting";
    this.updateState({ status, attempt: this.reconnectAttempts });

    let port: NativePortLike;
    try {
      port = this.connectNative(HOST_NAME);
    } catch (error) {
      this.scheduleReconnect(connectionIssueFromUnknown(error));
      return;
    }

    this.port = port;
    port.onMessage.addListener((message) => {
      this.handleMessage(port, message);
    });
    port.onDisconnect.addListener(() => {
      this.handleDisconnect(port);
    });
    this.beginHandshake(port);
  }

  private beginHandshake(port: NativePortLike): void {
    this.handshakeSequence += 1;
    const requestId = `native-handshake-${this.handshakeSequence}`;
    const timer = this.setTimer(() => {
      if (this.handshake?.requestId !== requestId) {
        return;
      }
      this.failConnection(
        new NativeClientError(
          "native_handshake_timeout",
          "Fragment native host did not complete protocol negotiation",
        ),
      );
    }, this.requestTimeoutMs);
    this.handshake = { requestId, timer };

    try {
      port.postMessage({
        type: "ping",
        requestId,
        protocolVersion: NATIVE_PROTOCOL_VERSION,
        minimumProtocolVersion: MINIMUM_NATIVE_PROTOCOL_VERSION,
      });
    } catch (error) {
      this.clearHandshake();
      this.port = undefined;
      this.scheduleReconnect(connectionIssueFromUnknown(error));
    }
  }

  private handleMessage(port: NativePortLike, rawResponse: unknown): void {
    if (this.port !== port) {
      return;
    }
    const parsed = nativeResponseSchema.safeParse(rawResponse);
    if (!parsed.success) {
      this.failConnection(
        new NativeClientError(
          "native_response_invalid",
          "Fragment native host returned an invalid response",
        ),
      );
      return;
    }

    const response = parsed.data;
    if (this.handshake?.requestId === response.requestId) {
      this.completeHandshake(response);
      return;
    }

    const pending = this.pending.get(response.requestId);
    if (!pending) {
      this.failConnection(
        new NativeClientError(
          "native_response_request_id_mismatch",
          "Fragment native host returned an unexpected request ID",
        ),
      );
      return;
    }
    if (!isExpectedResponse(pending.request, response)) {
      this.failConnection(
        new NativeClientError(
          "native_response_type_mismatch",
          "Fragment native host returned the wrong response type",
        ),
      );
      return;
    }

    this.clearTimer(pending.timer);
    this.pending.delete(response.requestId);
    pending.resolve(response as NativeResponse);
  }

  private completeHandshake(response: ParsedNativeResponse): void {
    if (response.type !== "pong") {
      this.failConnection(
        new NativeClientError(
          "native_handshake_invalid",
          "Fragment native host rejected protocol negotiation",
        ),
      );
      return;
    }

    const hostProtocolVersion = response.protocolVersion ?? 1;
    const hostMinimumProtocolVersion =
      response.minimumProtocolVersion ?? hostProtocolVersion;
    if (
      response.compatible === false ||
      hostProtocolVersion < MINIMUM_NATIVE_PROTOCOL_VERSION ||
      hostMinimumProtocolVersion > NATIVE_PROTOCOL_VERSION
    ) {
      this.failConnection(
        new NativeClientError(
          "native_protocol_incompatible",
          `Fragment host protocol ${hostProtocolVersion} is not compatible with extension protocol ${NATIVE_PROTOCOL_VERSION}`,
        ),
      );
      return;
    }

    this.clearHandshake();
    this.hasConnected = true;
    this.reconnectAttempts = 0;
    this.updateState({
      status: "connected",
      attempt: 0,
      protocolVersion: hostProtocolVersion,
      hostVersion: response.version,
    });
    for (const pending of this.pending.values()) {
      this.postPendingRequest(pending);
    }
  }

  private postPendingRequest(pending: PendingRequest | undefined): void {
    if (!pending || pending.sent || !this.port) {
      return;
    }
    pending.sent = true;
    try {
      this.port.postMessage(pending.request);
    } catch (error) {
      pending.sent = false;
      this.failConnection(connectionIssueFromUnknown(error));
    }
  }

  private handleDisconnect(port: NativePortLike): void {
    if (this.port !== port || this.disposed) {
      return;
    }
    this.port = undefined;
    this.clearHandshake();
    const message =
      this.getLastErrorMessage() ?? "Fragment native host disconnected";
    const issue = new NativeClientError(
      isMissingHostMessage(message)
        ? "native_host_unavailable"
        : "native_host_disconnected",
      message,
    );
    this.rejectSent(issue);
    this.scheduleReconnect(issue);
  }

  private handleRequestTimeout(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(requestId);
    pending.reject(
      new NativeClientError(
        "native_host_timeout",
        "Fragment native host did not respond in time",
      ),
    );
    if (pending.sent) {
      this.failConnection(
        new NativeClientError(
          "native_host_timeout",
          "Fragment native host connection was reset after a timeout",
        ),
      );
    }
  }

  private failConnection(error: NativeClientError): void {
    const port = this.port;
    this.port = undefined;
    this.clearHandshake();
    this.rejectAll(error);
    port?.disconnect();
    this.scheduleReconnect(error);
  }

  private scheduleReconnect(issue: NativeConnectionIssue): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const error = new NativeClientError(issue.code, issue.message);
      this.rejectAll(error);
      this.updateState({
        status: "unavailable",
        attempt: this.reconnectAttempts,
        error: issue,
      });
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** (this.reconnectAttempts - 1),
      this.reconnectMaxDelayMs,
    );
    this.updateState({
      status: "reconnecting",
      attempt: this.reconnectAttempts,
      error: issue,
    });
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private clearHandshake(): void {
    if (!this.handshake) {
      return;
    }
    this.clearTimer(this.handshake.timer);
    this.handshake = undefined;
  }

  private rejectSent(error: NativeClientError): void {
    for (const [requestId, pending] of this.pending) {
      if (!pending.sent) {
        continue;
      }
      this.clearTimer(pending.timer);
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }

  private rejectAll(error: NativeClientError): void {
    for (const pending of this.pending.values()) {
      this.clearTimer(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private updateState(state: NativeConnectionState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(this.connectionState());
    }
  }
}

export const nativePortManager = new NativePortManager();

export function sendNativeMessage(
  request: NativeRequest,
): Promise<NativeResponse> {
  return nativePortManager.request(request);
}

function isExpectedResponse(
  request: NativeRequest,
  response: ParsedNativeResponse,
): boolean {
  if (response.type === "error") {
    return true;
  }
  switch (request.type) {
    case "ping":
      return response.type === "pong";
    case "frames.list":
      return response.type === "frames.list.result";
    case "capture.fragment":
      return response.type === "capture.fragment.result";
  }
}

function connectionIssueFromUnknown(error: unknown): NativeClientError {
  if (error instanceof NativeClientError) {
    return error;
  }
  return new NativeClientError(
    "native_host_unavailable",
    error instanceof Error
      ? error.message
      : "Fragment native host is unavailable",
  );
}

function isMissingHostMessage(message: string): boolean {
  return /host.*not found|specified native messaging host|not connected/i.test(
    message,
  );
}
