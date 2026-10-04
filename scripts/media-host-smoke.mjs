// Real native executable + HTTP + SQLite proof. This does not control Chrome or prove its toolbar UX.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const host = resolve(
  process.argv[2] ?? join(root, "target/release/fragment-host"),
);
const output = resolve(
  process.argv[3] ?? join(root, "output/v0.0.8/media-host-smoke.json"),
);
const vault = mkdtempSync(join(tmpdir(), "fragment-media-host-"));
const svg = readFileSync(join(root, "fixtures/media/two-color.svg"));
const png = readFileSync(join(root, "fixtures/media/solid-red.png"));
const routes = new Map([
  ["/image.svg", svg],
  ["/slow.svg", Buffer.concat([svg, Buffer.from("<!-- slow -->")])],
  [
    "/killed.svg",
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><defs><filter id="noise"><feTurbulence type="fractalNoise" baseFrequency=".01" numOctaves="8"/></filter></defs><rect width="1600" height="1600" filter="url(#noise)"/></svg>',
    ),
  ],
  ["/over-budget.svg", svg],
  ["/after.svg", Buffer.concat([svg, Buffer.from("<!-- after -->")])],
  ["/bad.svg", readFileSync(join(root, "fixtures/media/external.svg"))],
  ["/image.png", png],
]);
const server = createServer((request, response) => {
  const bytes = routes.get(request.url);
  if (!bytes) {
    response.writeHead(404).end();
    return;
  }
  const send = () => {
    response.writeHead(200, {
      "content-type": request.url.endsWith("svg")
        ? "image/svg+xml"
        : "image/png",
    });
    response.end(bytes);
  };
  if (request.url === "/slow.svg") setTimeout(send, 9000);
  else if (request.url === "/over-budget.svg") setTimeout(send, 21000);
  else send();
});
await new Promise((done, fail) => {
  server.once("error", fail);
  server.listen(0, "127.0.0.1", done);
});
const origin = `http://127.0.0.1:${server.address().port}`;

function client() {
  const child = spawn(host, [], {
    env: { ...process.env, FRAGMENT_APP_DATA_DIR: vault },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let bytes = Buffer.alloc(0),
    stderr = "";
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    bytes = Buffer.concat([bytes, chunk]);
    while (bytes.length >= 4 && bytes.length >= bytes.readUInt32LE(0) + 4) {
      const length = bytes.readUInt32LE(0);
      assert(length <= 1024 * 1024);
      const response = JSON.parse(bytes.subarray(4, length + 4));
      bytes = bytes.subarray(length + 4);
      const request = pending.get(response.requestId);
      assert(request, `Unknown response ID: ${response.requestId}`);
      pending.delete(response.requestId);
      clearTimeout(request.timer);
      request.done(response);
    }
  });
  child.once("exit", () => {
    for (const { fail, timer } of pending.values()) {
      clearTimeout(timer);
      fail(new Error(stderr));
    }
    pending.clear();
  });
  return {
    child,
    request(message) {
      return new Promise((done, fail) => {
        const timer = setTimeout(() => {
          pending.delete(message.requestId);
          fail(new Error("Host watchdog expired"));
        }, 45000);
        pending.set(message.requestId, { done, fail, timer });
        const body = Buffer.from(JSON.stringify(message)),
          prefix = Buffer.alloc(4);
        prefix.writeUInt32LE(body.length);
        child.stdin.write(Buffer.concat([prefix, body]));
      });
    },
    async close() {
      const exited = new Promise((done) => child.once("exit", done));
      child.stdin.end();
      await exited;
    },
  };
}
let native = client();
let serial = 0;
const request = (type) =>
  native.request({ type, requestId: `media-${++serial}` });
const results = [];
try {
  const pong = await request("ping");
  assert(pong.capabilities.includes("svg"));
  const frame = (await request("frames.list")).frames[0].id;
  const capture = (path) =>
    native.request({
      type: "capture.fragment",
      requestId: `media-${++serial}`,
      frameId: frame,
      candidate: {
        id: path,
        src: origin + path,
        sourceUrl: origin + path,
        pageUrl: "https://example.com/fragment-svg-smoke",
        siteName: "Fragment test fixture",
        width: 640,
        height: 320,
        rect: { x: 0, y: 0, width: 640, height: 320 },
        source: "generic",
      },
      tags: ["media-smoke"],
      requestedAt: new Date().toISOString(),
      extensionVersion: pong.version,
    });
  for (const path of ["/image.svg", "/image.png", "/bad.svg"]) {
    const response = await capture(path);
    assert.equal(response.ok, path !== "/bad.svg");
    if (!response.ok) assert.equal(response.error.code, "unsupported_svg");
    results.push({ path, response });
  }
  const start = performance.now();
  const slow = capture("/slow.svg");
  const queuedPing = request("ping"); // Actual sequential host, queued behind a >8-second capture.
  const slowResult = await slow;
  const elapsedMs = performance.now() - start;
  assert(slowResult.ok && elapsedMs >= 9000);
  assert((await queuedPing).ok);
  results.push({
    path: "/slow.svg",
    elapsedMs,
    response: slowResult,
    queuedPing: "correct response ID",
  });
  const deadlineStart = performance.now();
  const overBudget = await capture("/over-budget.svg");
  const deadlineElapsedMs = performance.now() - deadlineStart;
  assert.equal(overBudget.ok, false);
  assert(deadlineElapsedMs >= 19000 && deadlineElapsedMs < 23000);
  results.push({
    path: "/over-budget.svg",
    elapsedMs: deadlineElapsedMs,
    response: overBudget,
  });

  if (process.platform === "darwin") {
    const killed = capture("/killed.svg");
    let killedPid;
    const deadline = Date.now() + 5000;
    while (!killedPid && Date.now() < deadline) {
      const children = spawnSync("pgrep", ["-P", String(native.child.pid)], {
        encoding: "utf8",
      })
        .stdout.trim()
        .split(/\s+/)
        .filter(Boolean);
      for (const pid of children) {
        const command = spawnSync("ps", ["-p", pid, "-o", "command="], {
          encoding: "utf8",
        }).stdout;
        if (command.includes("--render-svg")) {
          process.kill(Number(pid), "SIGKILL");
          killedPid = Number(pid);
          break;
        }
      }
      if (!killedPid) await new Promise((done) => setTimeout(done, 10));
    }
    assert(killedPid, "Did not observe a render child to kill");
    const failed = await killed;
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "svg_worker_unavailable");
    assert((await capture("/after.svg")).ok);
    results.push({
      renderChildKilled: true,
      parentRemainedConnected: true,
      nextCaptureSucceeded: true,
    });
  }
  await native.close();
  native = client();
  assert((await request("ping")).ok);
  const duplicate = await capture("/image.svg");
  assert(duplicate.ok && duplicate.duplicateOfFragmentId);
  results.push({ reopenedHost: true, duplicateUsesSavedAsset: true });
  await native.close();
  native = null;

  const rows = JSON.parse(
    spawnSync(
      "sqlite3",
      [
        "-json",
        join(vault, "fragment.db"),
        "SELECT f.id,f.source_url,f.page_url,a.original_path,a.thumbnail_path,a.preview_path,a.mime_type,a.sha256,p.status,(SELECT count(*) FROM asset_palette_colors c WHERE c.asset_id=a.id) AS color_count FROM fragments f JOIN assets a ON a.id=f.asset_id JOIN asset_palettes p ON p.asset_id=a.id",
      ],
      { encoding: "utf8" },
    ).stdout,
  );
  for (const row of rows) {
    const bytes = readFileSync(join(vault, row.original_path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256);
    assert(bytes.equals(routes.get(new URL(row.source_url).pathname)));
    assert.equal(row.page_url, "https://example.com/fragment-svg-smoke");
    assert.equal(row.status, "ready");
    assert(row.color_count > 0 && row.color_count <= 6);
    for (const path of [row.thumbnail_path, row.preview_path])
      assert.equal(
        readFileSync(join(vault, path)).subarray(0, 8).toString("hex"),
        "89504e470d0a1a0a",
      );
  }
  assert(existsSync(join(vault, "fragment.db")));
  const report = {
    ok: true,
    layer: "native executable, HTTP and SQLite; not Chrome UI",
    version: pong.version,
    host,
    hostSha256: createHash("sha256").update(readFileSync(host)).digest("hex"),
    vault,
    results,
    assets: rows,
  };
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      { ok: true, output, assets: rows.length, slowCaptureMs: elapsedMs },
      null,
      2,
    ),
  );
} finally {
  if (native) await native.close();
  await new Promise((done) => server.close(done));
}
