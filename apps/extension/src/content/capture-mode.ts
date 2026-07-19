import { findImageCandidates } from "./image-detector";
import { CaptureOverlay } from "./overlay";

declare global {
  interface Window {
    __fragmentCaptureMode?: CaptureController;
  }
}

type CaptureController = {
  enabled: boolean;
  overlay: CaptureOverlay;
  observer?: MutationObserver;
  refresh: () => void;
  enable: () => void;
  disable: () => void;
};

function controller() {
  if (window.__fragmentCaptureMode) {
    return window.__fragmentCaptureMode;
  }

  let state: CaptureController;
  let overlay: CaptureOverlay;
  let refreshTimer: number | undefined;
  const refresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      overlay.update(findImageCandidates());
    }, 80);
  };
  overlay = new CaptureOverlay(
    () => state.disable(),
    () => refresh(),
  );
  const observer = new MutationObserver(refresh);

  state = {
    enabled: false,
    overlay,
    observer,
    refresh,
    enable: () => {
      if (state.enabled) {
        refresh();
        return;
      }
      state.enabled = true;
      state.overlay.enable(findImageCandidates());
      state.observer?.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "srcset", "style", "class"],
      });
    },
    disable: () => {
      state.enabled = false;
      window.clearTimeout(refreshTimer);
      refreshTimer = undefined;
      observer.disconnect();
      overlay.disable();
    },
  };
  window.__fragmentCaptureMode = state;
  return state;
}

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message.type === "fragment.capture.toggle") {
    const state = controller();
    if (state.enabled) {
      state.disable();
    } else {
      state.enable();
    }
  }

  if (message.type === "fragment.capture.disable") {
    controller().disable();
  }
});

function enableWhenReady() {
  controller().enable();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", enableWhenReady, { once: true });
} else {
  enableWhenReady();
}
