// Disposable QA hook for the focused preview overlay (wt-21). Import it from
// main.tsx in a QA source copy only and run the app with VITE_FRAGMENT_QA=1,
// VITE_FRAGMENT_PERF=1 and DEBUG=vite:time. It is never imported by the
// shipping frontend.
//
// Commands are polled from /qa-commands.json (drop the file into
// apps/desktop/public while the dev server runs; one command per file, each with
// a fresh "id"). Results are GET requests to /favicon.svg?p=<json>, which the
// Vite dev server prints with DEBUG=vite:time, so nothing needs a console.
//
// Commands:
//   { id, type: "seed", frameName, files: ["/abs/a.jpg", ...] }
//   { id, type: "measure-open", run, start, count }
//   { id, type: "measure-nav", run, start, steps }
//   { id, type: "memory-cycle", run, count, cycles, idleMs }
//   { id, type: "open-hold", card, holdMs, steps }   (for screenshots)
// The hook lives outside apps/desktop, so it uses the WebView bridge directly
// instead of importing @tauri-apps/api.
const invoke = (command, args) =>
  window.__TAURI_INTERNALS__.invoke(command, args);

const POLL_MS = 1500;
const CARD = ".v7-frame-card-action";
const OVERLAY = ".v7-focused-overlay";
const STAGE = ".v7-focused-image-stage";
const FULL = ".v7-focused-image-full";
const NAV_LABEL = /^(Frames|All Fragments)$/;

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => resolve(performance.now())),
  );
const round = (value) => Math.round(value * 10) / 10;
const cards = () => [...document.querySelectorAll(CARD)];

// Reports hit a real public file so Vite logs the query string verbatim; an
// unknown path would be rewritten to /index.html before the time log runs.
function report(payload) {
  const p = encodeURIComponent(JSON.stringify({ t: Date.now(), ...payload }));
  return fetch(`/favicon.svg?p=${p}`, { cache: "no-store" }).catch(
    () => undefined,
  );
}

function pressKey(code, key) {
  const init = { key, code, bubbles: true, cancelable: true };
  window.dispatchEvent(new KeyboardEvent("keydown", init));
  window.dispatchEvent(new KeyboardEvent("keyup", init));
}

async function waitFor(predicate, timeout = 10000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await frame();
  }
  throw new Error("timed out waiting");
}

function nextOverlay(previous) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const element = document.querySelector(OVERLAY);
      return element && element !== previous ? element : null;
    };
    const now = check();
    if (now) return resolve({ element: now, at: performance.now() });
    const observer = new MutationObserver(() => {
      const element = check();
      if (!element) return;
      observer.disconnect();
      resolve({ element, at: performance.now() });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error("overlay did not open"));
    }, 10000);
  });
}

function paintable(img) {
  return (
    img.complete &&
    img.naturalWidth > 0 &&
    parseFloat(getComputedStyle(img).opacity) > 0.01
  );
}

function fullImage(stage) {
  const imgs = [...stage.querySelectorAll("img")];
  return stage.querySelector(FULL) ?? imgs[imgs.length - 1] ?? null;
}

async function measureOpen(overlay, t0, timeout = 15000) {
  const stage = await waitFor(() => overlay.querySelector(STAGE), 5000);
  let firstAt = null;
  let decodedAt = null;
  let path = null;
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const now = await frame();
    const imgs = [...stage.querySelectorAll("img")];
    const full = fullImage(stage);
    if (firstAt === null) {
      const ready = imgs.find((img) => img.complete && img.naturalWidth > 0);
      if (ready) {
        firstAt = now;
        path = ready.classList.contains("v7-focused-image-thumb")
          ? "thumbnail"
          : ready === full
            ? "preview"
            : "other";
      }
    }
    if (full && full.complete && full.naturalWidth > 0) {
      await full.decode().catch(() => undefined);
      decodedAt = await frame();
      if (firstAt === null) {
        firstAt = decodedAt;
        path = "preview";
      }
      break;
    }
  }
  return {
    firstPixelsMs: firstAt === null ? null : round(firstAt - t0),
    decodedMs: decodedAt === null ? null : round(decodedAt - t0),
    path,
  };
}

function internalSample() {
  const sample = window.__fragmentPerf?.preview?.samples?.at(-1);
  return sample
    ? {
        first: sample.firstPixelsMs,
        decoded: sample.previewDecodedMs,
        path: sample.path,
        kind: sample.kind,
      }
    : null;
}

async function closeOverlay() {
  pressKey("Escape", "Escape");
  await waitFor(() => !document.querySelector(OVERLAY), 5000);
  await settle(250);
}

async function goToFrames() {
  const row = [
    ...document.querySelectorAll(".v7-primary-nav .v7-sidebar-row"),
  ].find((button) =>
    NAV_LABEL.test(
      button.querySelector(".v7-sidebar-label")?.textContent?.trim() ?? "",
    ),
  );
  row?.click();
  await waitFor(() => cards().length > 0, 10000);
  await settle(400);
}

async function ensureCards(count) {
  for (let attempt = 0; attempt < 40 && cards().length < count; attempt++) {
    const page = document.querySelector(".v7-frames-page");
    if (page) page.scrollTop = page.scrollHeight;
    document.querySelector(".v7-pagination-button")?.click();
    await settle(700);
  }
  const page = document.querySelector(".v7-frames-page");
  if (page) page.scrollTop = 0;
  await settle(300);
  return cards().length;
}

async function openCard(index) {
  const card = cards()[index];
  if (!card) throw new Error(`no card at ${index}`);
  card.scrollIntoView({ block: "center" });
  await settle(200);
  const previous = document.querySelector(OVERLAY);
  const opening = nextOverlay(previous);
  card.click();
  return opening;
}

async function seed(command) {
  const frames = await invoke("list_frames");
  let target = frames.find((frame) => frame.name === command.frameName);
  if (!target) {
    target = await invoke("create_frame", {
      parentId: null,
      name: command.frameName,
    });
  }
  let done = 0;
  let failed = 0;
  for (const filePath of command.files) {
    try {
      await invoke("import_image", {
        frameId: target.id,
        filePath,
        titleOverride: null,
      });
      done += 1;
    } catch (error) {
      failed += 1;
      await report({
        kind: "seed-error",
        file: filePath,
        error: String(error),
      });
    }
    if ((done + failed) % 10 === 0) {
      await report({ kind: "seed-progress", done, failed });
    }
  }
  await report({ kind: "seed-done", done, failed, frameId: target.id });
  await settle(500);
  location.reload();
}

async function measureOpens(command) {
  await goToFrames();
  await ensureCards(command.start + command.count);
  for (let i = 0; i < command.count; i++) {
    const { element, at } = await openCard(command.start + i);
    const measured = await measureOpen(element, at);
    await report({
      kind: "open",
      run: command.run,
      i,
      card: command.start + i,
      ...measured,
      internal: internalSample(),
    });
    await settle(350);
    await closeOverlay();
  }
  await report({ kind: "done", id: command.id });
}

async function navigate(overlay, steps, run, reportSteps) {
  const stage = overlay.querySelector(STAGE);
  const intervals = [];
  let previousFrame = null;
  let sampling = true;
  const sampler = () => {
    const now = performance.now();
    if (previousFrame !== null) intervals.push(now - previousFrame);
    previousFrame = now;
    if (sampling) requestAnimationFrame(sampler);
  };
  requestAnimationFrame(sampler);

  for (let step = 0; step < steps; step++) {
    const before = fullImage(stage)?.src ?? null;
    const t0 = performance.now();
    pressKey("ArrowRight", "ArrowRight");
    let blank = 0;
    let frames = 0;
    let firstAt = null;
    let decodedAt = null;
    const deadline = t0 + 10000;
    while (performance.now() < deadline) {
      const now = await frame();
      frames += 1;
      const imgs = [...stage.querySelectorAll("img")];
      const visible = imgs.some(paintable);
      if (!visible) blank += 1;
      else if (firstAt === null) firstAt = now;
      const full = fullImage(stage);
      if (
        full &&
        full.src !== before &&
        full.complete &&
        full.naturalWidth > 0
      ) {
        await full.decode().catch(() => undefined);
        decodedAt = await frame();
        break;
      }
    }
    if (reportSteps) {
      await report({
        kind: "nav",
        run,
        step,
        firstPixelsMs: firstAt === null ? null : round(firstAt - t0),
        decodedMs: decodedAt === null ? null : round(decodedAt - t0),
        blankFrames: blank,
        frames,
        internal: internalSample(),
      });
    }
    await settle(120);
  }
  sampling = false;
  const sorted = [...intervals].sort((a, b) => a - b);
  const pick = (fraction) =>
    sorted.length
      ? round(
          sorted[
            Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
          ],
        )
      : null;
  return {
    frames: sorted.length,
    p50: pick(0.5),
    p95: pick(0.95),
    max: sorted.length ? round(sorted[sorted.length - 1]) : null,
    over100: sorted.filter((value) => value > 100).length,
  };
}

async function measureNav(command) {
  await goToFrames();
  await ensureCards(command.start + command.steps + 1);
  const { element, at } = await openCard(command.start);
  await measureOpen(element, at);
  await settle(300);
  const frames = await navigate(element, command.steps, command.run, true);
  await report({ kind: "nav-frames", run: command.run, ...frames });
  await closeOverlay();
  await report({ kind: "done", id: command.id });
}

async function memoryCycle(command) {
  await goToFrames();
  const available = await ensureCards(command.count);
  await report({ kind: "cycle-cards", run: command.run, available });
  for (let cycle = 0; cycle < command.cycles; cycle++) {
    await report({ kind: "cycle-start", run: command.run, cycle });
    const { element, at } = await openCard(0);
    await measureOpen(element, at);
    const frames = await navigate(
      element,
      command.count - 1,
      command.run,
      false,
    );
    await closeOverlay();
    await report({ kind: "cycle-closed", run: command.run, cycle, ...frames });
    await settle(command.idleMs ?? 12000);
    await report({ kind: "cycle-done", run: command.run, cycle });
  }
  await report({ kind: "done", id: command.id });
}

async function openHold(command) {
  await goToFrames();
  await ensureCards((command.card ?? 0) + (command.steps ?? 0) + 1);
  const { element, at } = await openCard(command.card ?? 0);
  await measureOpen(element, at);
  await report({ kind: "hold-open", id: command.id });
  await settle(command.holdMs ?? 8000);
  for (let step = 0; step < (command.steps ?? 0); step++) {
    pressKey("ArrowRight", "ArrowRight");
    await settle(command.stepMs ?? 1500);
  }
  await report({ kind: "hold-done", id: command.id });
  await settle(command.tailMs ?? 4000);
  await closeOverlay();
  await report({ kind: "done", id: command.id });
}

async function probe() {
  const started = performance.now();
  const rafDelay = await new Promise((resolve) =>
    requestAnimationFrame(() =>
      resolve(Math.round(performance.now() - started)),
    ),
  );
  return {
    visibility: document.visibilityState,
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
    rafDelayMs: rafDelay,
    cards: cards().length,
  };
}

async function run(command) {
  await report({
    kind: "command-start",
    id: command.id,
    type: command.type,
    ...(await probe()),
  });
  try {
    if (command.type === "seed") await seed(command);
    else if (command.type === "measure-open") await measureOpens(command);
    else if (command.type === "measure-nav") await measureNav(command);
    else if (command.type === "memory-cycle") await memoryCycle(command);
    else if (command.type === "open-hold") await openHold(command);
    else await report({ kind: "unknown-command", id: command.id });
  } catch (error) {
    await report({
      kind: "command-error",
      id: command.id,
      error: String(error),
    });
  }
}

async function poll() {
  try {
    const response = await fetch(`/qa-commands.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (response.ok) {
      const command = await response.json();
      const doneKey = `fragment-qa-done:${command?.id ?? ""}`;
      if (command?.id && !sessionStorage.getItem(doneKey)) {
        sessionStorage.setItem(doneKey, "1");
        await run(command);
      }
    }
  } catch {
    // No command file yet, or the SPA fallback answered; try again shortly.
  }
  setTimeout(poll, POLL_MS);
}

if (import.meta.env?.VITE_FRAGMENT_QA === "1") {
  window.__fragmentQa = { run, report };
  setTimeout(poll, 2000);
}
