#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const extensionDir = join(rootDir, "apps", "extension", "dist");
const hostPath =
  process.env.FRAGMENT_HOST_PATH ??
  join(
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
const chromePath =
  process.env.FRAGMENT_CHROME_PATH ?? chromium.executablePath();
const nativePreflightTimeoutMs = Number(
  process.env.FRAGMENT_NATIVE_PREFLIGHT_TIMEOUT_MS ?? 8000,
);

ensureBuilds();

if (!existsSync(chromePath)) {
  throw new Error(`Chrome executable was not found at ${chromePath}`);
}

const smokeRoot = mkdtempSync(join(tmpdir(), "fragment-extension-smoke-"));
const profileDir = join(smokeRoot, "chrome-profile");
const vaultDir = join(smokeRoot, "vault");
const smokeHostPath = join(
  smokeRoot,
  process.platform === "win32" ? "fragment-host.exe" : "fragment-host",
);
const hostTracePath = join(smokeRoot, "fragment-host-trace.log");
mkdirSync(profileDir, { recursive: true });
mkdirSync(vaultDir, { recursive: true });
installSmokeHost(hostPath, smokeHostPath);

const server = createServer((request, response) => {
  if (request.url === "/fragment.png") {
    const imageBytes = readFileSync(sourceImagePath);
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": imageBytes.byteLength,
      connection: "close",
    });
    response.end(imageBytes);
    return;
  }

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <html>
      <head>
        <title>Fragment Smoke Gallery</title>
        <meta property="og:site_name" content="Fragment Smoke">
        <style>
          body { margin: 0; min-height: 100vh; background: #090909; display: grid; place-items: center; }
          img { width: 520px; height: 520px; object-fit: cover; border-radius: 24px; }
        </style>
      </head>
      <body>
        <a href="${serverOrigin(server)}/fragment.png">
          <img src="${serverOrigin(server)}/fragment.png" alt="Fragment smoke image">
        </a>
      </body>
    </html>`);
});

const hostManifests = [
  ...chromeNativeHostManifestPaths(),
  join(profileDir, "NativeMessagingHosts", "com.autoscale.fragment.json"),
  join(
    profileDir,
    "Default",
    "NativeMessagingHosts",
    "com.autoscale.fragment.json",
  ),
];
const extensionId = extensionIdFromManifest();
let context;
try {
  await listen(server);
  installNativeHostManifests({
    extensionId,
    manifestPaths: hostManifests,
    hostPath: smokeHostPath,
  });
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: false,
    env: {
      ...process.env,
      FRAGMENT_APP_DATA_DIR: vaultDir,
      FRAGMENT_HOST_TRACE_FILE: hostTracePath,
    },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=DialMediaRouteProvider",
    ],
  });

  await preflightNativeHost(context, extensionId);

  const page = await context.newPage();
  await page.goto(serverOrigin(server), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("img[alt='Fragment smoke image']");

  await toggleCaptureMode(context, extensionId, serverOrigin(server));
  await page.waitForFunction(() =>
    Boolean(document.querySelector("fragment-capture-overlay")?.shadowRoot),
  );
  await page.waitForFunction(() => {
    const root = document.querySelector("fragment-capture-overlay")?.shadowRoot;
    return Boolean(root?.querySelector(".save-button"));
  });
  await page.evaluate(() => {
    const root = document.querySelector("fragment-capture-overlay")?.shadowRoot;
    root
      ?.querySelector(".save-button")
      ?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
  });
  await waitForPickerReady(page);
  await page.evaluate(() => {
    const root = document.querySelector("fragment-capture-overlay")?.shadowRoot;
    const tags = root?.querySelector("input[name='tags']");
    const note = root?.querySelector("textarea[name='note']");
    if (tags instanceof HTMLInputElement) {
      tags.value = "smoke, extension";
      tags.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (note instanceof HTMLTextAreaElement) {
      note.value = "Extension capture smoke";
      note.dispatchEvent(new Event("input", { bubbles: true }));
    }
    root
      ?.querySelector(".picker")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => {
    const root = document.querySelector("fragment-capture-overlay")?.shadowRoot;
    const status = root?.querySelector(".picker-status")?.textContent ?? "";
    return status.includes("Saved") || status.includes("Already saved");
  });

  const originals = walkFiles(join(vaultDir, "originals"));
  const thumbnails = walkFiles(join(vaultDir, "thumbnails"));
  const previews = walkFiles(join(vaultDir, "previews"));
  const dbPath = join(vaultDir, "fragment.db");
  if (!existsSync(dbPath) || statSync(dbPath).size === 0) {
    throw new Error("Extension smoke did not create fragment.db");
  }
  if (
    originals.length === 0 ||
    thumbnails.length === 0 ||
    previews.length === 0
  ) {
    throw new Error("Extension smoke did not create expected asset files");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        extensionId,
        vaultDir,
        originals: originals.length,
        thumbnails: thumbnails.length,
        previews: previews.length,
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close().catch(() => undefined);
  await closeServer(server).catch(() => undefined);
  restoreNativeHostManifests(hostManifests);
}

function ensureBuilds() {
  run("pnpm", ["--filter", "@fragment/extension", "build"]);
  if (!existsSync(hostPath)) {
    run("cargo", ["build", "-p", "fragment-host", "--bin", "fragment-host"]);
  }
  if (!existsSync(sourceImagePath)) {
    throw new Error(`Missing smoke image at ${sourceImagePath}`);
  }
}

function extensionIdFromManifest() {
  const manifestPath = join(extensionDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Extension manifest is missing at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.key !== "string" || manifest.key.length === 0) {
    throw new Error(
      "Extension manifest key is required for stable native host smoke",
    );
  }
  const hash = createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest();
  return [...hash.subarray(0, 16)]
    .map(
      (byte) =>
        String.fromCharCode(97 + (byte >> 4)) +
        String.fromCharCode(97 + (byte & 0x0f)),
    )
    .join("");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function installSmokeHost(source, destination) {
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
  if (process.platform === "darwin") {
    spawnSync("xattr", ["-c", destination], { stdio: "ignore" });
  }
}

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
  return new Promise((resolveClose, rejectClose) => {
    serverInstance.close((error) => {
      if (error) {
        rejectClose(error);
      } else {
        resolveClose();
      }
    });
  });
}

function serverOrigin(serverInstance) {
  const address = serverInstance.address();
  if (!address || typeof address === "string") {
    throw new Error("smoke server is not listening on a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function waitForPickerReady(page) {
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector(
        "fragment-capture-overlay",
      )?.shadowRoot;
      const status = root?.querySelector(".picker-status")?.textContent ?? "";
      return (
        status.includes("Ready") || status.includes("Inbox will be created")
      );
    });
  } catch (error) {
    const overlayText = await page.evaluate(() => {
      const root = document.querySelector(
        "fragment-capture-overlay",
      )?.shadowRoot;
      return root?.textContent?.replace(/\s+/g, " ").trim() ?? "no overlay";
    });
    const screenshotPath = join(
      rootDir,
      "output",
      "playwright",
      "fragment-extension-smoke-failed.png",
    );
    mkdirSync(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath });
    throw new Error(
      `Capture picker did not become ready. Overlay text: ${overlayText}. Screenshot: ${screenshotPath}. Cause: ${error}`,
    );
  }
}

async function preflightNativeHost(contextInstance, extensionId) {
  const extensionPage = await contextInstance.newPage();
  try {
    await extensionPage.goto(
      `chrome-extension://${extensionId}/src/popup/index.html`,
    );
    const direct = await extensionPage.evaluate(
      (timeoutMs) =>
        new Promise((resolve) => {
          const timeout = window.setTimeout(() => {
            resolve({ ok: false, timeout: true, route: "direct" });
          }, timeoutMs);
          chrome.runtime.sendNativeMessage(
            "com.autoscale.fragment",
            { type: "frames.list", requestId: "preflight-direct-frames" },
            (reply) => {
              window.clearTimeout(timeout);
              resolve({
                ok: Boolean(reply?.ok),
                reply,
                lastError: chrome.runtime.lastError?.message,
                route: "direct",
              });
            },
          );
        }),
      nativePreflightTimeoutMs,
    );
    if (!direct.ok) {
      throw new Error(
        `Direct native host preflight failed: ${JSON.stringify(direct)}. Host trace: ${readOptionalText(hostTracePath)}`,
      );
    }

    const routed = await extensionPage.evaluate(
      (timeoutMs) =>
        new Promise((resolve) => {
          const timeout = window.setTimeout(() => {
            resolve({ ok: false, timeout: true, route: "background" });
          }, timeoutMs);
          chrome.runtime.sendMessage(
            { type: "fragment.frames.list", requestId: "preflight-frames" },
            (reply) => {
              window.clearTimeout(timeout);
              resolve({
                ok: Boolean(reply?.ok),
                reply,
                lastError: chrome.runtime.lastError?.message,
                route: "background",
              });
            },
          );
        }),
      nativePreflightTimeoutMs,
    );
    if (!routed.ok) {
      throw new Error(
        `Native host preflight failed: ${JSON.stringify(routed)}. Host trace: ${readOptionalText(hostTracePath)}`,
      );
    }
  } finally {
    await extensionPage.close().catch(() => undefined);
  }
}

function readOptionalText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "not created";
}

function chromeNativeHostManifestPaths() {
  if (process.platform === "darwin") {
    return [
      join(
        process.env.HOME,
        "Library",
        "Application Support",
        "Google",
        "Chrome",
        "NativeMessagingHosts",
        "com.autoscale.fragment.json",
      ),
      join(
        process.env.HOME,
        "Library",
        "Application Support",
        "Google",
        "Chrome for Testing",
        "NativeMessagingHosts",
        "com.autoscale.fragment.json",
      ),
      join(
        process.env.HOME,
        "Library",
        "Application Support",
        "Google",
        "ChromeForTesting",
        "NativeMessagingHosts",
        "com.autoscale.fragment.json",
      ),
      join(
        process.env.HOME,
        "Library",
        "Application Support",
        "Chromium",
        "NativeMessagingHosts",
        "com.autoscale.fragment.json",
      ),
    ];
  }
  if (process.platform === "win32") {
    throw new Error("Windows native-host smoke is not implemented yet");
  }
  return [
    join(
      process.env.HOME,
      ".config",
      "google-chrome",
      "NativeMessagingHosts",
      "com.autoscale.fragment.json",
    ),
    join(
      process.env.HOME,
      ".config",
      "chromium",
      "NativeMessagingHosts",
      "com.autoscale.fragment.json",
    ),
  ];
}

function installNativeHostManifests({
  extensionId,
  manifestPaths,
  hostPath: nativeHostPath,
}) {
  for (const manifestPath of manifestPaths) {
    const backupPath = backupManifestPath(manifestPath);
    mkdirSync(dirname(manifestPath), { recursive: true });
    if (existsSync(backupPath)) {
      rmSync(backupPath, { force: true });
    }
    if (existsSync(manifestPath)) {
      renameSync(manifestPath, backupPath);
    }
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          name: "com.autoscale.fragment",
          description: "Fragment native messaging host",
          path: nativeHostPath,
          type: "stdio",
          allowed_origins: [`chrome-extension://${extensionId}/`],
        },
        null,
        2,
      ),
    );
  }
}

function restoreNativeHostManifests(manifestPaths) {
  for (const manifestPath of manifestPaths) {
    const backupPath = backupManifestPath(manifestPath);
    rmSync(manifestPath, { force: true });
    if (existsSync(backupPath)) {
      copyFileSync(backupPath, manifestPath);
      rmSync(backupPath, { force: true });
    }
  }
}

function backupManifestPath(manifestPath) {
  return `${manifestPath}.fragment-smoke-backup`;
}

async function toggleCaptureMode(contextInstance, extensionId, pageOrigin) {
  const extensionPage = await contextInstance.newPage();
  try {
    await extensionPage.goto(
      `chrome-extension://${extensionId}/src/popup/index.html`,
    );
    return await extensionPage.evaluate(async (origin) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url?.startsWith(origin));
      if (!tab?.id) {
        throw new Error(`No smoke page tab was found for ${origin}`);
      }
      await chrome.tabs.sendMessage(tab.id, {
        type: "fragment.capture.toggle",
      });
      return tab.id;
    }, pageOrigin);
  } finally {
    await extensionPage.close().catch(() => undefined);
  }
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
