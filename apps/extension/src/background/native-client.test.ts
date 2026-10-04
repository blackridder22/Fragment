import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativePortManager, type NativePortLike } from "./native-client";

class FakeEvent<TListener extends (...args: never[]) => void> {
  private readonly listeners = new Set<TListener>();

  addListener(listener: TListener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: TListener): void {
    this.listeners.delete(listener);
  }

  emit(...args: Parameters<TListener>): void {
    for (const listener of this.listeners) {
      listener(...args);
    }
  }
}

class FakePort implements NativePortLike {
  readonly posted: unknown[] = [];
  readonly onMessage = new FakeEvent<(message: unknown) => void>();
  readonly onDisconnect = new FakeEvent<() => void>();
  disconnected = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  disconnect(): void {
    this.disconnected = true;
    this.onDisconnect.emit();
  }

  disconnectFromHost(): void {
    this.disconnected = true;
    this.onDisconnect.emit();
  }

  completeHandshake(protocolVersion?: number): void {
    const ping = this.posted[0] as { requestId: string };
    this.onMessage.emit({
      type: "pong",
      requestId: ping.requestId,
      ok: true,
      app: "Fragment",
      version: "0.0.3",
      ...(protocolVersion === undefined
        ? {}
        : {
            protocolVersion,
            minimumProtocolVersion: 1,
            compatible: true,
          }),
    });
  }
}

describe("persistent native port manager", () => {
  it("serializes dispatch and starts the short timeout only after a queued capture finishes", async () => {
    const port = new FakePort();
    const manager = new NativePortManager({
      connectNative: () => port,
      maxReconnectAttempts: 0,
    });
    const capture = manager.request({
      type: "capture.fragment",
      requestId: "slow-capture",
      frameId: "inbox",
      candidate: {
        id: "slow",
        src: "https://example.com/slow.png",
        pageUrl: "https://example.com",
        width: 640,
        height: 480,
        rect: { x: 0, y: 0, width: 640, height: 480 },
        source: "generic",
      },
      requestedAt: "2026-09-05T00:00:00Z",
      extensionVersion: "0.0.8",
    });
    port.completeHandshake(2);
    const frames = manager.request({
      type: "frames.list",
      requestId: "queued-frames",
    });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(port.posted).toHaveLength(2);
    port.onMessage.emit({
      type: "capture.fragment.result",
      requestId: "slow-capture",
      ok: true,
      fragmentId: "saved",
    });
    await expect(capture).resolves.toMatchObject({ ok: true });
    expect(port.posted).toHaveLength(3);
    port.onMessage.emit({
      type: "frames.list.result",
      requestId: "queued-frames",
      ok: true,
      frames: [],
    });
    await expect(frames).resolves.toMatchObject({ frames: [] });
    manager.dispose();
  });

  it("explains SVG support when the negotiated host lacks the capability", async () => {
    const port = new FakePort();
    const manager = new NativePortManager({
      connectNative: () => port,
      maxReconnectAttempts: 0,
    });
    const request = manager.request({
      type: "capture.fragment",
      requestId: "svg-old-host",
      frameId: "inbox",
      candidate: {
        id: "svg",
        src: "https://example.com/logo.svg",
        pageUrl: "https://example.com",
        width: 640,
        height: 480,
        rect: { x: 0, y: 0, width: 640, height: 480 },
        source: "generic",
      },
      requestedAt: "2026-09-05T00:00:00Z",
      extensionVersion: "0.0.8",
    });
    port.completeHandshake(2);
    await expect(request).rejects.toMatchObject({
      code: "svg_host_upgrade_required",
    });
    expect(port.posted).toHaveLength(1);
    manager.dispose();
  });

  it("bounds the unsent queue and expires queued work separately", async () => {
    const port = new FakePort();
    const manager = new NativePortManager({
      connectNative: () => port,
      queueTimeoutMs: 50,
      requestTimeoutMs: 1000,
      maxReconnectAttempts: 0,
    });
    const first = manager.request({ type: "frames.list", requestId: "active" });
    port.completeHandshake(2);
    const queued = Array.from({ length: 32 }, (_, index) =>
      manager
        .request({ type: "frames.list", requestId: `queued-${index}` })
        .catch((error) => error.code),
    );
    await expect(
      manager.request({ type: "frames.list", requestId: "overflow" }),
    ).rejects.toMatchObject({ code: "native_queue_full" });
    await vi.advanceTimersByTimeAsync(50);
    expect(await Promise.all(queued)).toEqual(
      Array(32).fill("native_queue_timeout"),
    );
    port.onMessage.emit({
      type: "frames.list.result",
      requestId: "active",
      ok: true,
      frames: [],
    });
    await first;
    manager.dispose();
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a missing native host", async () => {
    const port = new FakePort();
    const manager = new NativePortManager({
      connectNative: () => port,
      getLastErrorMessage: () => "Specified native messaging host not found",
      maxReconnectAttempts: 0,
      requestTimeoutMs: 1_000,
    });
    const request = manager.request({
      type: "frames.list",
      requestId: "frames-missing",
    });

    port.disconnectFromHost();

    await expect(request).rejects.toMatchObject({
      code: "native_host_unavailable",
    });
    expect(manager.connectionState().status).toBe("unavailable");
    manager.dispose();
  });

  it("times out an unresponsive request", async () => {
    const port = new FakePort();
    const manager = new NativePortManager({
      connectNative: () => port,
      requestTimeoutMs: 100,
      maxReconnectAttempts: 0,
    });
    const request = manager.request({
      type: "frames.list",
      requestId: "frames-timeout",
    });
    const rejection = expect(request).rejects.toMatchObject({
      code: "native_host_timeout",
    });
    port.completeHandshake(2);

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    manager.dispose();
  });

  it("rejects a mismatched response request ID", async () => {
    const port = new FakePort();
    const manager = new NativePortManager({
      connectNative: () => port,
      requestTimeoutMs: 1_000,
      maxReconnectAttempts: 0,
    });
    const request = manager.request({
      type: "frames.list",
      requestId: "frames-expected",
    });
    port.completeHandshake(2);
    port.onMessage.emit({
      type: "frames.list.result",
      requestId: "frames-wrong",
      ok: true,
      frames: [],
    });

    await expect(request).rejects.toMatchObject({
      code: "native_response_request_id_mismatch",
    });
    manager.dispose();
  });

  it("reconnects with backoff and sends queued work once", async () => {
    const firstPort = new FakePort();
    const secondPort = new FakePort();
    const ports = [firstPort, secondPort];
    const manager = new NativePortManager({
      connectNative: () => {
        const port = ports.shift();
        if (!port) {
          throw new Error("No fake port available");
        }
        return port;
      },
      getLastErrorMessage: () => "Native host restarted",
      reconnectBaseDelayMs: 20,
      reconnectMaxDelayMs: 20,
      maxReconnectAttempts: 2,
      requestTimeoutMs: 1_000,
    });
    const request = manager.request({
      type: "frames.list",
      requestId: "frames-reconnect",
    });

    firstPort.disconnectFromHost();
    await vi.advanceTimersByTimeAsync(20);
    secondPort.completeHandshake(2);
    secondPort.onMessage.emit({
      type: "frames.list.result",
      requestId: "frames-reconnect",
      ok: true,
      frames: [],
    });

    await expect(request).resolves.toMatchObject({
      type: "frames.list.result",
      requestId: "frames-reconnect",
    });
    expect(
      secondPort.posted.filter(
        (message) =>
          (message as { requestId?: string }).requestId === "frames-reconnect",
      ),
    ).toHaveLength(1);
    expect(manager.connectionState()).toMatchObject({
      status: "connected",
      protocolVersion: 2,
      hostVersion: "0.0.3",
    });
    manager.dispose();
  });

  it("accepts the previous protocol response without negotiation fields", async () => {
    const port = new FakePort();
    const manager = new NativePortManager({
      connectNative: () => port,
      requestTimeoutMs: 1_000,
      maxReconnectAttempts: 0,
    });
    const request = manager.request({
      type: "frames.list",
      requestId: "frames-legacy",
    });
    port.completeHandshake();
    port.onMessage.emit({
      type: "frames.list.result",
      requestId: "frames-legacy",
      ok: true,
      frames: [],
    });

    await expect(request).resolves.toMatchObject({
      requestId: "frames-legacy",
    });
    expect(manager.connectionState().protocolVersion).toBe(1);
    manager.dispose();
  });

  it("accepts null optional fields from a successful capture response", async () => {
    const port = new FakePort();
    const manager = new NativePortManager({
      connectNative: () => port,
      requestTimeoutMs: 1_000,
      maxReconnectAttempts: 0,
    });
    const request = manager.request({
      type: "capture.fragment",
      requestId: "capture-nullable-response",
      frameId: "inbox",
      frameIds: ["inbox"],
      candidate: {
        id: "candidate-1",
        src: "https://example.com/reference.png",
        pageUrl: "https://example.com/gallery",
        width: 640,
        height: 480,
        rect: { x: 0, y: 0, width: 640, height: 480 },
        source: "generic",
      },
      requestedAt: "2026-08-23T00:00:00.000Z",
      extensionVersion: "0.0.7",
    });
    port.completeHandshake(2);
    port.onMessage.emit({
      type: "capture.fragment.result",
      requestId: "capture-nullable-response",
      ok: true,
      fragmentId: "fragment-1",
      fragmentIds: ["fragment-1"],
      duplicateOfFragmentId: null,
      duplicateOfFragmentIds: null,
      thumbnailPath: "thumbnails/fragment-1.png",
      error: null,
    });

    await expect(request).resolves.toMatchObject({
      type: "capture.fragment.result",
      requestId: "capture-nullable-response",
      ok: true,
      fragmentId: "fragment-1",
    });
    expect(manager.connectionState().status).toBe("connected");
    manager.dispose();
  });
});
