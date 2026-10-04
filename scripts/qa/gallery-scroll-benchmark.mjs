#!/usr/bin/env node
// Scroll benchmark for the Frames gallery harness in headless Chromium.
//
//   node scripts/qa/gallery-scroll-benchmark.mjs [url] [runs] [seconds] [label]
//
// Opens apps/desktop/qa/gallery-harness.html (served by `vite --port 5180`),
// goes to the Frames page, loads every page of the 1,000-item Vault, then
// scrolls continuously for `seconds` per run while sampling requestAnimationFrame
// intervals, the mounted `.fragment-card` count, layout-shift and longtask
// entries. Prints JSON. Headless Chromium runs requestAnimationFrame at 60 Hz
// without the hidden-surface throttling an embedded browser applies.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5180/qa/gallery-harness.html";
const runs = Number(process.argv[3] ?? 3);
const seconds = Number(process.argv[4] ?? 30);
const label = process.argv[5] ?? "run";
// GALLERY_BENCH_HIDE_IMAGES=1 hides every card image so image decode and raster
// drop out of the measurement and only layout, windowing and React remain.
const hideImages = process.env.GALLERY_BENCH_HIDE_IMAGES === "1";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(String(error)));
await page.goto(url, { waitUntil: "load" });
await page.locator(".fragment-card").first().waitFor({ timeout: 30000 });
await page.evaluate(() => {
  [...document.querySelectorAll(".v7-sidebar button")]
    .find((button) => button.textContent?.trim().startsWith("Frames"))
    ?.click();
});
await page
  .locator(".v7-frames-page .fragment-card")
  .first()
  .waitFor({ timeout: 30000 });
if (hideImages) {
  await page.addStyleTag({
    content: ".v7-frame-image { display: none !important; }",
  });
}

const session = await page.evaluate(
  async ({ runs, seconds, label }) => {
    const container = () => document.querySelector(".v7-frames-page");
    const cards = () => document.querySelectorAll(".fragment-card").length;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const progressText = () =>
      document.querySelector(".v7-pagination-progress")?.textContent ?? "";

    async function loadAll(target = 1000, cap = 180000) {
      const c = container();
      const start = performance.now();
      let last = progressText();
      let stale = 0;
      while (performance.now() - start < cap) {
        if (!document.querySelector(".v7-pagination-footer")) break;
        if (progressText().startsWith(`Showing ${target.toLocaleString()} of`))
          break;
        c.scrollTop = c.scrollHeight;
        await sleep(150);
        const now = progressText();
        if (now === last) {
          stale += 1;
          if (stale > 120) break;
        } else {
          stale = 0;
          last = now;
        }
      }
      c.scrollTop = 0;
      await sleep(500);
      return {
        progress: progressText() || null,
        galleryHeight:
          document.querySelector(".v7-frame-gallery")?.style.height ?? null,
        scrollHeight: c.scrollHeight,
        ms: Math.round(performance.now() - start),
      };
    }

    function scrollRun(runSeconds, runLabel) {
      return new Promise((resolve) => {
        const c = container();
        c.scrollTop = 0;
        const intervals = [];
        const stallsAt = [];
        let previous = null;
        let maxCards = 0;
        let direction = 1;
        let cls = 0;
        let shifts = 0;
        let longTasks = 0;
        let longTaskMs = 0;
        const shiftObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              cls += entry.value;
              shifts += 1;
            }
          }
        });
        try {
          shiftObserver.observe({ type: "layout-shift", buffered: false });
        } catch {}
        const taskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks += 1;
            longTaskMs += entry.duration;
          }
        });
        try {
          taskObserver.observe({ type: "longtask", buffered: false });
        } catch {}
        const started = performance.now();
        let frame = 0;
        const tick = (now) => {
          if (previous !== null) {
            const delta = now - previous;
            intervals.push(delta);
            if (delta > 100)
              stallsAt.push([Math.round(now - started), Math.round(delta)]);
          }
          previous = now;
          const t = (now - started) / 1000;
          // Trackpad-like continuous scroll: 18 to 32 px per frame, reversing at the ends.
          const velocity = 18 + 14 * Math.sin((2 * Math.PI * t) / 4);
          const max = c.scrollHeight - c.clientHeight;
          if (direction > 0 && c.scrollTop >= max - 1) direction = -1;
          if (direction < 0 && c.scrollTop <= 1) direction = 1;
          c.scrollTop += direction * velocity;
          frame += 1;
          if (frame % 6 === 0) maxCards = Math.max(maxCards, cards());
          if (now - started < runSeconds * 1000) {
            requestAnimationFrame(tick);
            return;
          }
          shiftObserver.disconnect();
          taskObserver.disconnect();
          const sorted = [...intervals].sort((a, b) => a - b);
          const percentile = (p) =>
            sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
          resolve({
            label: runLabel,
            frames: intervals.length,
            p50: +percentile(0.5).toFixed(2),
            p95: +percentile(0.95).toFixed(2),
            max: +sorted[sorted.length - 1].toFixed(2),
            over20: intervals.filter((i) => i > 20).length,
            over100: stallsAt.length,
            stallsAt,
            maxCards,
            cls: +cls.toFixed(4),
            shifts,
            longTasks,
            longTaskMs: Math.round(longTaskMs),
            scrollHeight: c.scrollHeight,
            viewport: c.clientHeight,
          });
        };
        requestAnimationFrame(tick);
      });
    }

    const loaded = await loadAll();
    const results = [];
    for (let index = 0; index < runs; index += 1) {
      results.push(await scrollRun(seconds, `${label}#${index + 1}`));
      await sleep(500);
    }
    return {
      label,
      loaded,
      runs: results,
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    };
  },
  { runs, seconds, label },
);

session.pageErrors = consoleErrors;
session.hideImages = hideImages;
session.heapMB = await page.evaluate(() =>
  performance.memory
    ? Math.round(performance.memory.usedJSHeapSize / 1048576)
    : null,
);
session.userAgent = await page.evaluate(() => navigator.userAgent);
console.log(JSON.stringify(session, null, 2));
await browser.close();
