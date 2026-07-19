#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const options = parseArgs(process.argv.slice(2));
const outputDir = join(process.cwd(), "output", "pinterest-quality-benchmark");
const assetDir = join(outputDir, "assets");
mkdirSync(assetDir, { recursive: true });

const galleryDlAvailable = !options.noGalleryDl && commandExists("gallery-dl");
const samples =
  options.urls.length > 0
    ? options.urls.slice(0, options.limit).map((url, index) => ({
        id: `cli-${index + 1}`,
        title: `URL ${index + 1}`,
        source_url: url,
        page_url: url,
        width: null,
        height: null,
        file_size: null,
      }))
    : sampleSavedPinterestFragments(options.limit);

if (samples.length === 0) {
  console.error(
    "No Pinterest URLs found. Pass URLs directly or import/capture Pinterest Fragments first.",
  );
  process.exit(1);
}

const results = [];
for (const sample of samples) {
  console.log(`\nBenchmarking ${sample.title || sample.id}`);
  const candidates = new Map();
  addCandidate(candidates, "saved-source", sample.source_url);
  addCandidate(candidates, "saved-page", sample.page_url);
  for (const url of pinterestHighQualityVariants(sample.source_url)) {
    addCandidate(candidates, "pinimg-variant", url);
  }

  if (galleryDlAvailable) {
    for (const url of galleryDlUrls(sample.page_url || sample.source_url)) {
      addCandidate(candidates, "gallery-dl", url);
    }
  }

  const inspected = [];
  for (const [url, labels] of candidates) {
    if (!isLikelyImageDownloadUrl(url) && !labels.includes("gallery-dl")) {
      inspected.push({
        url,
        labels,
        ok: false,
        error: "skipped non-image URL",
      });
      continue;
    }
    inspected.push(await downloadAndInspect(url, labels, assetDir));
  }

  const best = inspected
    .filter((item) => item.ok)
    .sort(
      (left, right) => right.area - left.area || right.bytes - left.bytes,
    )[0];
  const currentArea = Number(sample.width || 0) * Number(sample.height || 0);
  const bestArea = best?.area ?? 0;
  const gain =
    currentArea > 0 && bestArea > 0
      ? Number((bestArea / currentArea).toFixed(2))
      : null;

  results.push({
    fragmentId: sample.id,
    title: sample.title,
    existing: {
      width: sample.width,
      height: sample.height,
      fileSize: sample.file_size,
      area: currentArea || null,
      sourceUrl: sample.source_url,
      pageUrl: sample.page_url,
    },
    best,
    gain,
    candidates: inspected,
  });

  console.log(
    `  existing=${sample.width || "?"}x${sample.height || "?"} best=${
      best ? `${best.width}x${best.height}` : "none"
    } gain=${gain ?? "?"}`,
  );
}

const reportPath = join(
  outputDir,
  `report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
writeFileSync(
  reportPath,
  JSON.stringify({ galleryDlAvailable, results }, null, 2),
);

console.log("\nPinterest quality benchmark");
console.log(`gallery-dl: ${galleryDlAvailable ? "available" : "not used"}`);
console.log(`report: ${reportPath}`);
console.log("\n| Fragment | Existing | Best | Gain | Source |");
console.log("| --- | ---: | ---: | ---: | --- |");
for (const result of results) {
  const existing =
    result.existing.width && result.existing.height
      ? `${result.existing.width}x${result.existing.height}`
      : "?";
  const best = result.best
    ? `${result.best.width}x${result.best.height}`
    : "none";
  const label = result.best?.labels?.join("+") ?? "-";
  console.log(
    `| ${escapeCell(result.title || result.fragmentId)} | ${existing} | ${best} | ${
      result.gain ?? "?"
    } | ${label} |`,
  );
}

function parseArgs(args) {
  const parsed = {
    limit: 10,
    noGalleryDl: false,
    urls: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      parsed.limit = Number.parseInt(args[++index] ?? "10", 10);
    } else if (arg === "--no-gallery-dl") {
      parsed.noGalleryDl = true;
    } else if (arg === "--urls") {
      const filePath = args[++index];
      parsed.urls.push(
        ...readFileSync(filePath, "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("http://") || arg.startsWith("https://")) {
      parsed.urls.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  parsed.limit =
    Number.isFinite(parsed.limit) && parsed.limit > 0 ? parsed.limit : 10;
  return parsed;
}

function sampleSavedPinterestFragments(limit) {
  const dbPath = join(vaultRoot(), "fragment.db");
  if (!existsSync(dbPath)) {
    return [];
  }
  if (!commandExists("sqlite3")) {
    throw new Error("sqlite3 is required to sample saved Fragment URLs.");
  }
  const query = `
    SELECT id, title, source_url, page_url, width, height, file_size
    FROM fragments
    WHERE deleted_at IS NULL
      AND (
        source_url LIKE '%pinimg.com%'
        OR source_url LIKE '%pinterest.%'
        OR page_url LIKE '%pinterest.%'
      )
    ORDER BY captured_at DESC
    LIMIT ${Number(limit)};
  `;
  const result = spawnSync("sqlite3", ["-json", dbPath, query], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "sqlite3 query failed");
  }
  return JSON.parse(result.stdout || "[]");
}

function vaultRoot() {
  return (
    process.env.FRAGMENT_APP_DATA_DIR ||
    join(homedir(), "Library", "Application Support", "Fragment")
  );
}

function commandExists(command) {
  return (
    spawnSync("command", ["-v", command], {
      shell: true,
      stdio: "ignore",
    }).status === 0
  );
}

function addCandidate(candidates, label, url) {
  if (!url || !url.trim()) {
    return;
  }
  const normalized = url.trim();
  const labels = candidates.get(normalized) ?? [];
  if (!labels.includes(label)) {
    labels.push(label);
  }
  candidates.set(normalized, labels);
}

function pinterestHighQualityVariants(url) {
  if (!url) {
    return [];
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("pinimg.com")) {
      return [];
    }
    const segments = parsed.pathname.split("/");
    const sizeIndex = segments.findIndex((segment) => /^\d+x$/.test(segment));
    if (sizeIndex === -1) {
      return [];
    }
    return ["1200x", "originals"].map((size) => {
      const next = new URL(parsed);
      const nextSegments = [...segments];
      nextSegments[sizeIndex] = size;
      next.pathname = nextSegments.join("/");
      return next.href;
    });
  } catch {
    return [];
  }
}

function isLikelyImageDownloadUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.endsWith("pinimg.com") ||
      /\.(avif|bmp|gif|jpe?g|png|webp)(\?.*)?$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function galleryDlUrls(url) {
  if (!url) {
    return [];
  }
  const result = spawnSync("gallery-dl", ["--get-urls", url], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"));
}

async function downloadAndInspect(url, labels, directory) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_DOWNLOAD_BYTES) {
      throw new Error("too large");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error("too large");
    }
    const filePath = join(directory, safeFileName(url));
    writeFileSync(filePath, bytes);
    const dimensions = inspectDimensions(filePath);
    if (!dimensions) {
      rmSync(filePath, { force: true });
      throw new Error("not an inspectable image");
    }
    return {
      url,
      labels,
      ok: true,
      width: dimensions.width,
      height: dimensions.height,
      area: dimensions.width * dimensions.height,
      bytes: bytes.byteLength,
      filePath,
    };
  } catch (error) {
    return {
      url,
      labels,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function inspectDimensions(filePath) {
  const result = spawnSync(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", filePath],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return null;
  }
  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function safeFileName(url) {
  const parsed = new URL(url);
  const extension = basename(parsed.pathname).split(".").pop() || "img";
  return `${Buffer.from(url).toString("base64url").slice(0, 44)}.${extension}`;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").slice(0, 80);
}
