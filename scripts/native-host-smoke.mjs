#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const hostPath = join(
  rootDir,
  "target",
  "debug",
  process.platform === "win32" ? "fragment-host.exe" : "fragment-host",
);
const sourceImagePath = join(
  rootDir,
  "apps",
  "desktop",
  "public",
  "Fragment.png",
);

if (!existsSync(hostPath)) {
  const build = spawnSync(
    "cargo",
    ["build", "-p", "fragment-host", "--bin", "fragment-host"],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

if (!existsSync(sourceImagePath)) {
  throw new Error(`Missing smoke image at ${sourceImagePath}`);
}

const vaultDir = mkdtempSync(join(tmpdir(), "fragment-native-host-smoke-"));
const imageBytes = readFileSync(sourceImagePath);
const server = createServer((request, response) => {
  if (request.url !== "/fragment.png") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": imageBytes.byteLength,
    connection: "close",
  });
  response.end(imageBytes);
});

function listen(serverInstance) {
  return new Promise((resolveListen, rejectListen) => {
    serverInstance.once("error", rejectListen);
    serverInstance.listen(0, "127.0.0.1", () => {
      serverInstance.off("error", rejectListen);
      resolveListen(serverInstance.address());
    });
  });
}

function closeServer(serverInstance) {
  return new Promise((resolveClose) => serverInstance.close(resolveClose));
}

function walkFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(fullPath);
    }
    return [fullPath];
  });
}

function encodeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.byteLength, 0);
  return Buffer.concat([length, body]);
}

function createNativeClient(command, env) {
  const child = spawn(command, {
    cwd: rootDir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = Buffer.alloc(0);
  const queued = [];
  const waiting = [];
  let stderr = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.byteLength >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.byteLength < length + 4) {
        return;
      }

      const body = buffer.subarray(4, length + 4);
      buffer = buffer.subarray(length + 4);
      const message = JSON.parse(body.toString("utf8"));
      const waiter = waiting.shift();
      if (waiter) {
        waiter.resolve(message);
      } else {
        queued.push(message);
      }
    }
  });

  child.once("exit", (code, signal) => {
    const error = new Error(
      `fragment-host exited before response: code=${code ?? "null"} signal=${signal ?? "null"}\n${stderr}`,
    );
    while (waiting.length > 0) {
      waiting.shift().reject(error);
    }
  });

  return {
    stderr: () => stderr,
    request(message) {
      child.stdin.write(encodeNativeMessage(message));
      if (queued.length > 0) {
        return Promise.resolve(queued.shift());
      }

      return new Promise((resolveRequest, rejectRequest) => {
        const timeout = setTimeout(() => {
          rejectRequest(
            new Error(`Timed out waiting for native response.\n${stderr}`),
          );
        }, 10000);

        waiting.push({
          resolve: (value) => {
            clearTimeout(timeout);
            resolveRequest(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            rejectRequest(error);
          },
        });
      });
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

const address = await listen(server);
const imageUrl = `http://127.0.0.1:${address.port}/fragment.png`;
const nativeClient = createNativeClient(hostPath, {
  ...process.env,
  FRAGMENT_APP_DATA_DIR: vaultDir,
});

try {
  const ping = await nativeClient.request({
    type: "ping",
    requestId: "smoke-ping",
  });
  if (!ping.ok || ping.type !== "pong") {
    throw new Error(`Unexpected ping response: ${JSON.stringify(ping)}`);
  }

  const frames = await nativeClient.request({
    type: "frames.list",
    requestId: "smoke-frames",
  });
  if (
    !frames.ok ||
    frames.type !== "frames.list.result" ||
    !Array.isArray(frames.frames) ||
    frames.frames.length === 0
  ) {
    throw new Error(`Unexpected frames response: ${JSON.stringify(frames)}`);
  }

  const frameId = frames.frames[0].id;
  const capture = await nativeClient.request({
    type: "capture.fragment",
    requestId: "smoke-capture",
    frameId,
    candidate: {
      id: "smoke-candidate",
      src: imageUrl,
      pageUrl: "https://example.com/fragment-smoke",
      sourceUrl: imageUrl,
      siteName: "Fragment Smoke",
      alt: "Fragment smoke asset",
      width: 1024,
      height: 1024,
      naturalWidth: 1024,
      naturalHeight: 1024,
      rect: { x: 0, y: 0, width: 512, height: 512 },
      source: "generic",
    },
    note: "Native host smoke capture",
    tags: ["smoke", "fragment"],
    requestedAt: new Date().toISOString(),
    extensionVersion: "0.1.0",
  });

  if (
    !capture.ok ||
    capture.type !== "capture.fragment.result" ||
    !capture.fragmentId
  ) {
    throw new Error(`Unexpected capture response: ${JSON.stringify(capture)}`);
  }

  const originals = walkFiles(join(vaultDir, "originals"));
  const thumbnails = walkFiles(join(vaultDir, "thumbnails"));
  const previews = walkFiles(join(vaultDir, "previews"));
  const dbPath = join(vaultDir, "fragment.db");

  if (!existsSync(dbPath) || statSync(dbPath).size === 0) {
    throw new Error("Smoke capture did not create fragment.db");
  }
  // Originals at or below 1600 px are their own preview, so `previews/` may
  // legitimately stay empty; the thumbnail is always written.
  if (originals.length === 0 || thumbnails.length === 0) {
    throw new Error(
      "Smoke capture did not create original and thumbnail files",
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        vaultDir,
        fragmentId: capture.fragmentId,
        originals: originals.length,
        thumbnails: thumbnails.length,
        previews: previews.length,
      },
      null,
      2,
    ),
  );
} finally {
  nativeClient.close();
  await closeServer(server);
}
