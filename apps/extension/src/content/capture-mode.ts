import type { ImageCandidate } from "@fragment/shared";
import {
  candidateElementForId,
  findImageCandidates,
  releaseCandidateElement,
  refreshCandidateRects,
} from "./image-detector";
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

const MUTATION_DEBOUNCE_MS = 140;

function controller() {
  if (window.__fragmentCaptureMode) {
    return window.__fragmentCaptureMode;
  }

  let state: CaptureController;
  let mutationTimer: number | undefined;
  let layoutFrame: number | undefined;
  const candidatesById = new Map<string, ImageCandidate>();
  const observedElements = new Map<string, Element>();
  const visibleCandidateIds = new Set<string>();
  const pendingRoots = new Set<ParentNode>();

  const overlay = new CaptureOverlay(
    () => state.disable(),
    () => scheduleLayoutRefresh(),
  );

  const intersectionObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const candidateId = entry.target.getAttribute(
                "data-fragment-candidate-observed",
              );
              if (!candidateId) {
                continue;
              }
              if (entry.isIntersecting) {
                visibleCandidateIds.add(candidateId);
              } else {
                visibleCandidateIds.delete(candidateId);
              }
            }
            scheduleLayoutRefresh();
          },
          { rootMargin: "160px" },
        )
      : undefined;

  const mutationObserver = new MutationObserver((records) => {
    if (!state.enabled || document.hidden) {
      return;
    }
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target instanceof Element) {
          queueRoot(record.target);
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          queueRoot(
            node.tagName === "SOURCE" && node.parentElement
              ? node.parentElement
              : node,
          );
        } else if (node instanceof DocumentFragment) {
          queueRoot(node);
        }
      }
    }
    scheduleMutationScan();
  });

  function queueRoot(root: ParentNode): void {
    if (
      root instanceof Element &&
      (root.matches("fragment-capture-overlay") ||
        root.closest("fragment-capture-overlay"))
    ) {
      return;
    }
    pendingRoots.add(root);
  }

  function scheduleMutationScan(): void {
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => {
      mutationTimer = undefined;
      const roots = compactRoots([...pendingRoots]);
      pendingRoots.clear();
      scanRoots(roots);
    }, MUTATION_DEBOUNCE_MS);
  }

  function scheduleLayoutRefresh(): void {
    if (!state.enabled || document.hidden || layoutFrame !== undefined) {
      return;
    }
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = undefined;
      overlay.update(currentOverlayCandidates());
    });
  }

  function currentOverlayCandidates(): ImageCandidate[] {
    const source = intersectionObserver
      ? [...candidatesById.values()].filter(
          (candidate) =>
            visibleCandidateIds.has(candidate.id) ||
            !candidateElementForId(candidate.id),
        )
      : [...candidatesById.values()];
    return refreshCandidateRects(source);
  }

  function fullScan(render = true): void {
    const discovered = findImageCandidates(document);
    const discoveredIds = new Set(discovered.map((candidate) => candidate.id));
    for (const candidateId of candidatesById.keys()) {
      if (!discoveredIds.has(candidateId)) {
        removeCandidate(candidateId);
      }
    }
    for (const candidate of discovered) {
      upsertCandidate(candidate);
    }
    if (render) {
      scheduleLayoutRefresh();
    }
  }

  function scanRoots(roots: ParentNode[]): void {
    for (const root of roots) {
      const previousIds = candidateIdsWithin(root);
      const discovered = findImageCandidates(root);
      const discoveredIds = new Set(
        discovered.map((candidate) => candidate.id),
      );
      for (const candidateId of previousIds) {
        if (!discoveredIds.has(candidateId)) {
          removeCandidate(candidateId);
        }
      }
      for (const candidate of discovered) {
        upsertCandidate(candidate);
      }
    }
    pruneDisconnectedCandidates();
    scheduleLayoutRefresh();
  }

  function upsertCandidate(candidate: ImageCandidate): void {
    candidatesById.set(candidate.id, candidate);
    const element = candidateElementForId(candidate.id);
    if (!element) {
      visibleCandidateIds.add(candidate.id);
      return;
    }

    const previousElement = observedElements.get(candidate.id);
    if (previousElement && previousElement !== element) {
      intersectionObserver?.unobserve(previousElement);
      previousElement.removeAttribute("data-fragment-candidate-observed");
    }
    if (previousElement !== element) {
      observedElements.set(candidate.id, element);
      element.setAttribute("data-fragment-candidate-observed", candidate.id);
      intersectionObserver?.observe(element);
    }
    if (!intersectionObserver || intersectsViewport(candidate)) {
      visibleCandidateIds.add(candidate.id);
    }
  }

  function removeCandidate(candidateId: string): void {
    const element = observedElements.get(candidateId);
    if (element) {
      intersectionObserver?.unobserve(element);
      element.removeAttribute("data-fragment-candidate-observed");
    }
    observedElements.delete(candidateId);
    visibleCandidateIds.delete(candidateId);
    candidatesById.delete(candidateId);
    releaseCandidateElement(candidateId);
  }

  function candidateIdsWithin(root: ParentNode): string[] {
    const ids: string[] = [];
    for (const candidateId of candidatesById.keys()) {
      const element = candidateElementForId(candidateId);
      if (!element) {
        continue;
      }
      if (
        root === element ||
        (root instanceof Node && root.contains(element))
      ) {
        ids.push(candidateId);
      }
    }
    return ids;
  }

  function pruneDisconnectedCandidates(): void {
    for (const candidateId of candidatesById.keys()) {
      const observedElement = observedElements.get(candidateId);
      if (observedElement && !observedElement.isConnected) {
        removeCandidate(candidateId);
      }
    }
  }

  function observeDocument(): void {
    if (!state.enabled || document.hidden) {
      return;
    }
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "style", "poster"],
    });
    for (const element of observedElements.values()) {
      intersectionObserver?.observe(element);
    }
  }

  state = {
    enabled: false,
    overlay,
    observer: mutationObserver,
    refresh: () => fullScan(),
    enable: () => {
      if (state.enabled) {
        fullScan();
        return;
      }
      state.enabled = true;
      fullScan(false);
      state.overlay.enable(currentOverlayCandidates());
      observeDocument();
    },
    disable: () => {
      state.enabled = false;
      window.clearTimeout(mutationTimer);
      mutationTimer = undefined;
      pendingRoots.clear();
      if (layoutFrame !== undefined) {
        window.cancelAnimationFrame(layoutFrame);
        layoutFrame = undefined;
      }
      mutationObserver.disconnect();
      intersectionObserver?.disconnect();
      for (const candidateId of [...candidatesById.keys()]) {
        removeCandidate(candidateId);
      }
      overlay.disable();
    },
  };

  document.addEventListener("visibilitychange", () => {
    if (!state.enabled) {
      return;
    }
    if (document.hidden) {
      mutationObserver.disconnect();
      intersectionObserver?.disconnect();
      return;
    }
    fullScan();
    observeDocument();
  });

  window.__fragmentCaptureMode = state;
  return state;
}

function compactRoots(roots: ParentNode[]): ParentNode[] {
  return roots.filter((root, index) => {
    if (!(root instanceof Node)) {
      return true;
    }
    return !roots.some((other, otherIndex) => {
      return (
        index !== otherIndex &&
        other instanceof Node &&
        other !== root &&
        other.contains(root)
      );
    });
  });
}

function intersectsViewport(candidate: ImageCandidate): boolean {
  return (
    candidate.rect.x + candidate.rect.width >= -160 &&
    candidate.rect.y + candidate.rect.height >= -160 &&
    candidate.rect.x <= window.innerWidth + 160 &&
    candidate.rect.y <= window.innerHeight + 160
  );
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
