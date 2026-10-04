// Injected only into disposable QA source copies. Never imported by the shipping app.
import { invoke } from "@tauri-apps/api/core";
let recording = false,
  run = 0;
window.addEventListener(
  "keydown",
  (event) => {
    if (
      !(
        event.ctrlKey &&
        event.altKey &&
        event.shiftKey &&
        event.code === "KeyM"
      ) ||
      recording
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    recording = true;
    run += 1;
    const intervals = [],
      started = performance.now();
    let previous = null;
    const badge = document.createElement("output");
    badge.textContent = `QA scroll ${run}: recording 30 seconds`;
    Object.assign(badge.style, {
      position: "fixed",
      bottom: "8px",
      right: "8px",
      zIndex: "99999",
      background: "#222",
      color: "#fff",
      padding: "5px",
      fontSize: "11px",
      pointerEvents: "none",
    });
    document.body.appendChild(badge);
    const tick = (now) => {
      if (previous !== null) intervals.push(now - previous);
      previous = now;
      if (now - started < 30000) requestAnimationFrame(tick);
      else {
        const details = {
          devicePixelRatio: window.devicePixelRatio,
          width: innerWidth,
          height: innerHeight,
          screenWidth: screen.width,
          screenHeight: screen.height,
          visibility: document.visibilityState,
          elapsedMs: now - started,
          userAgent: navigator.userAgent,
        };
        invoke("qa_record_metrics", {
          label: `scroll-${run}`,
          intervals,
          details,
        })
          .then(() => {
            badge.textContent = `QA scroll ${run}: saved`;
          })
          .catch((error) => {
            badge.textContent = String(error);
          })
          .finally(() => {
            recording = false;
          });
      }
    };
    requestAnimationFrame(tick);
  },
  true,
);
window.addEventListener("error", (event) => {
  void invoke("qa_record_metrics", {
    label: "error",
    intervals: [],
    details: {
      message: event.message,
      stack: event.error?.stack ?? "",
      filename: event.filename,
      line: event.lineno,
    },
  });
});
window.addEventListener("unhandledrejection", (event) => {
  void invoke("qa_record_metrics", {
    label: "rejection",
    intervals: [],
    details: {
      message: String(event.reason),
      stack: event.reason?.stack ?? "",
    },
  });
});
