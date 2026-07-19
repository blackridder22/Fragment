import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NativePortManager,
  type NativePortLike,
} from "./native-client";

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
    port.completeHandshake(2);

    await vi.advanceTimersByTimeAsync(100);

    await expect(request).rejects.toMatchObject({
      code: "native_host_timeout",
    });
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
          (message as { requestId?: string }).requestId ===
          "frames-reconnect",
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
});
