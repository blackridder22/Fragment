import type {
  CaptureFragmentRequest,
  Frame,
  ImageCandidate,
} from "@fragment/shared";
import { requestId, type BackgroundReply } from "../shared/messages";
import {
  runCaptureBatch,
  type CaptureBatchItemResult,
} from "./capture-batch";

type FrameLoadState =
  | { ok: true; frames: Frame[] }
  | { ok: false; message: string; setupHint: string };

type FrameChoice = {
  id: string;
  name: string;
};

type SaveBatchResult =
  | {
      ok: true;
      saved: number;
      existing: number;
      failures: number;
      attempted: number;
      batchToken: number;
      failedCandidates: ImageCandidate[];
      items: CaptureBatchItemResult[];
    }
  | { ok: false; cancelled: true };

export class CaptureOverlay {
  private host = document.createElement("fragment-capture-overlay");
  private shadow = this.host.attachShadow({ mode: "open" });
  private active = false;
  private candidates: ImageCandidate[] = [];
  private cleanupCallbacks: Array<() => void> = [];
  private markerById = new Map<string, HTMLElement>();
  private openCandidateId: string | undefined;
  private hoverCandidateId: string | undefined;
  private saveBatchToken = 0;
  private readonly logoUrl = chrome.runtime.getURL("icons/icon-32.png");

  constructor(
    private readonly onRequestDisable: () => void = () => undefined,
    private readonly onRequestRefresh: () => void = () => undefined,
  ) {
    this.host.style.position = "fixed";
    this.host.style.inset = "0";
    this.host.style.zIndex = "2147483647";
    this.host.style.pointerEvents = "none";
    this.shadow.innerHTML = `
      <style>${styles}</style>
      <div class="layer"></div>
      <div class="multi-tray" hidden>
        <span class="tray-count">0 visible</span>
        <button type="button" class="tray-save-visible">Select visible</button>
      </div>
    `;
    this.shadow
      .querySelector<HTMLButtonElement>(".tray-save-visible")
      ?.addEventListener("click", () => {
        void this.openBatchPicker();
      });
  }

  enable(candidates: ImageCandidate[]) {
    if (!document.documentElement.contains(this.host)) {
      document.documentElement.append(this.host);
    }
    this.active = true;
    this.candidates = candidates;
    this.render();
    this.attachGlobalEvents();
  }

  disable() {
    this.active = false;
    this.openCandidateId = undefined;
    this.hoverCandidateId = undefined;
    this.saveBatchToken += 1;
    this.resetMarkerState();
    this.markerById.clear();
    this.cleanupCallbacks.forEach((cleanup) => cleanup());
    this.cleanupCallbacks = [];
    this.host.remove();
  }

  update(candidates: ImageCandidate[]) {
    if (!this.active) {
      return;
    }
    this.candidates = candidates;
    this.render();
  }

  private attachGlobalEvents() {
    if (this.cleanupCallbacks.length > 0) {
      return;
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (this.closePicker()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        this.onRequestDisable();
      }
    };
    const pointerMove = (event: PointerEvent) => {
      this.updateHoveredCandidate(event.clientX, event.clientY);
    };
    const pointerLeave = () => {
      if (!this.hoverCandidateId) {
        return;
      }
      this.hoverCandidateId = undefined;
      this.render();
    };
    const refresh = () => this.onRequestRefresh();
    const pointerDown = (event: PointerEvent) => {
      if (!this.hasOpenPicker() || this.isEventInsideOverlayPanel(event)) {
        return;
      }
      this.closePicker();
      this.updateHoveredCandidate(event.clientX, event.clientY);
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("pointermove", pointerMove, true);
    window.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointerleave", pointerLeave);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    this.cleanupCallbacks.push(() =>
      window.removeEventListener("keydown", keydown),
    );
    this.cleanupCallbacks.push(() =>
      window.removeEventListener("pointermove", pointerMove, true),
    );
    this.cleanupCallbacks.push(() =>
      window.removeEventListener("pointerdown", pointerDown, true),
    );
    this.cleanupCallbacks.push(() =>
      document.removeEventListener("pointerleave", pointerLeave),
    );
    this.cleanupCallbacks.push(() =>
      window.removeEventListener("scroll", refresh, true),
    );
    this.cleanupCallbacks.push(() =>
      window.removeEventListener("resize", refresh),
    );
    this.cleanupCallbacks.push(() =>
      window.removeEventListener("focus", refresh),
    );
    this.cleanupCallbacks.push(() =>
      document.removeEventListener("visibilitychange", refresh),
    );
  }

  private render() {
    const layer = this.shadow.querySelector<HTMLDivElement>(".layer");
    if (!layer) {
      return;
    }

    if (this.openCandidateId && !this.shadow.querySelector(".picker")) {
      this.openCandidateId = undefined;
    }

    const visibleCandidates = this.visibleCandidates();
    this.updateMultiTray(visibleCandidates);
    const activeCandidates = this.activeCandidates(visibleCandidates);
    const activeIds = new Set(
      activeCandidates.map((candidate) => candidate.id),
    );
    for (const candidate of activeCandidates) {
      let marker = this.markerById.get(candidate.id);
      if (!marker) {
        marker = this.createMarker();
        this.markerById.set(candidate.id, marker);
        layer.append(marker);
      }
      this.updateMarker(marker, candidate);
    }

    for (const [id, marker] of this.markerById) {
      if (activeIds.has(id)) {
        continue;
      }
      marker.remove();
      this.markerById.delete(id);
      if (this.openCandidateId === id) {
        this.openCandidateId = undefined;
      }
    }
  }

  private visibleCandidates() {
    const visible = this.viewportCandidates(80);
    if (
      this.openCandidateId &&
      !visible.some((candidate) => candidate.id === this.openCandidateId)
    ) {
      const openCandidate = this.candidates.find(
        (candidate) => candidate.id === this.openCandidateId,
      );
      if (openCandidate) {
        return [openCandidate, ...visible.slice(0, 79)];
      }
    }
    return visible;
  }

  private viewportCandidates(limit: number) {
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight;
    return this.candidates
      .filter((candidate) => {
        const rect = candidate.rect;
        return (
          rect.x + rect.width >= 0 &&
          rect.y + rect.height >= 0 &&
          rect.x <= viewportWidth &&
          rect.y <= viewportHeight
        );
      })
      .slice(0, limit);
  }

  private activeCandidates(visibleCandidates: ImageCandidate[]) {
    const active: ImageCandidate[] = [];
    const hoveredCandidate = this.hoverCandidateId
      ? visibleCandidates.find(
          (candidate) => candidate.id === this.hoverCandidateId,
        )
      : undefined;
    if (hoveredCandidate) {
      active.push(hoveredCandidate);
    }

    const openCandidate =
      this.openCandidateId &&
      this.candidates.find((candidate) => candidate.id === this.openCandidateId);
    if (
      openCandidate &&
      !active.some((candidate) => candidate.id === openCandidate.id)
    ) {
      active.push(openCandidate);
    }
    return active;
  }

  private updateHoveredCandidate(clientX: number, clientY: number) {
    if (!this.active || this.isPointerInsideOpenMarker(clientX, clientY)) {
      return;
    }
    const candidate = this.candidateAtPoint(clientX, clientY);
    if (candidate?.id === this.hoverCandidateId) {
      return;
    }
    this.hoverCandidateId = candidate?.id;
    this.render();
  }

  private candidateAtPoint(clientX: number, clientY: number) {
    return this.candidates
      .filter((candidate) => {
        const rect = candidate.rect;
        return (
          clientX >= rect.x &&
          clientX <= rect.x + rect.width &&
          clientY >= rect.y &&
          clientY <= rect.y + rect.height
        );
      })
      .sort(
        (left, right) =>
          left.rect.width * left.rect.height -
          right.rect.width * right.rect.height,
      )[0];
  }

  private isPointerInsideOpenMarker(clientX: number, clientY: number) {
    if (!this.openCandidateId) {
      return false;
    }
    const marker = this.markerById.get(this.openCandidateId);
    if (!marker) {
      return false;
    }
    const rect = marker.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  private hasOpenPicker() {
    return Boolean(
      this.openCandidateId ||
        this.shadow.querySelector(".picker") ||
        this.shadow.querySelector(".batch-picker"),
    );
  }

  private isEventInsideOverlayPanel(event: Event) {
    return event.composedPath().some((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      return (
        node.classList.contains("marker") ||
        node.classList.contains("picker") ||
        node.classList.contains("batch-picker") ||
        node.classList.contains("multi-tray")
      );
    });
  }

  private closePicker() {
    if (
      !this.openCandidateId &&
      !this.shadow.querySelector(".picker") &&
      !this.shadow.querySelector(".batch-picker")
    ) {
      return false;
    }
    const closingCandidateId = this.openCandidateId;
    this.saveBatchToken += 1;
    this.shadow
      .querySelectorAll(".picker")
      .forEach((picker) => picker.remove());
    this.shadow
      .querySelectorAll(".batch-picker")
      .forEach((picker) => picker.remove());
    this.resetMarkerState();
    this.openCandidateId = undefined;
    if (closingCandidateId) {
      const marker = this.markerById.get(closingCandidateId);
      const candidate = this.candidates.find(
        (item) => item.id === closingCandidateId,
      );
      if (marker && candidate) {
        this.updateMarker(marker, candidate);
      }
    }
    this.render();
    return true;
  }

  private resetMarkerState() {
    this.shadow.querySelectorAll<HTMLElement>(".marker").forEach((marker) => {
      marker.classList.remove("is-open", "saved", "saving");
      const button = marker.querySelector<HTMLButtonElement>(".save-button");
      if (button) {
        button.disabled = false;
      }
    });
  }

  private createMarker() {
    const marker = document.createElement("div");
    marker.className = "marker";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "save-button";
    marker.append(button);
    return marker;
  }

  private updateMultiTray(visibleCandidates: ImageCandidate[]) {
    const tray = this.shadow.querySelector<HTMLDivElement>(".multi-tray");
    const count = this.shadow.querySelector<HTMLSpanElement>(".tray-count");
    if (!tray || !count) {
      return;
    }
    const visibleCount = visibleCandidates.length;
    tray.hidden = visibleCount === 0;
    count.textContent = `${visibleCount} visible`;
  }

  private updateMarker(marker: HTMLElement, candidate: ImageCandidate) {
    const isOpen = this.openCandidateId === candidate.id;
    marker.dataset.candidateId = candidate.id;
    marker.classList.toggle("is-open", isOpen);
    const markerWidth = isOpen ? 314 : 46;
    marker.style.left = `${clamp(
      candidate.rect.x + candidate.rect.width - markerWidth - 12,
      10,
      window.innerWidth - markerWidth - 10,
    )}px`;
    marker.style.top = `${clamp(
      isOpen ? candidate.rect.y + 12 : candidate.rect.y + candidate.rect.height - 58,
      10,
      window.innerHeight - (isOpen ? 520 : 58),
    )}px`;

    const button = marker.querySelector<HTMLButtonElement>(".save-button");
    if (!button) {
      return;
    }
    button.disabled = false;
    button.setAttribute("aria-label", "Save Fragment");
    button.title = "Save Fragment";
    button.innerHTML = `
      <img class="fragment-logo" alt="" src="${this.logoUrl}">
      <span class="save-label">Save Fragment</span>
    `;
    button.onclick = (event) => {
      event.stopPropagation();
      void this.openPicker(marker, candidate);
    };
  }

  private async openPicker(marker: HTMLElement, candidate: ImageCandidate) {
    this.shadow
      .querySelectorAll(".picker")
      .forEach((picker) => picker.remove());
    this.shadow
      .querySelectorAll(".marker")
      .forEach((item) => item.classList.remove("is-open"));
    this.openCandidateId = candidate.id;
    marker.classList.add("is-open");
    this.updateMarker(marker, candidate);

    const picker = document.createElement("form");
    picker.className = "picker";
    picker.innerHTML = `
      <div class="picker-header">
        <strong>Save Fragment</strong>
        <span>${candidate.siteName ?? sourceHost(candidate.pageUrl)}</span>
      </div>
      <div class="frame-picker-shell">
        <div class="frame-picker-heading">
          <span>Frames</span>
          <div class="frame-picker-actions">
            <button class="frame-select-all" type="button">Select all</button>
            <button class="frame-select-none" type="button">Deselect</button>
          </div>
        </div>
        <div class="frame-picker" data-frame-picker></div>
      </div>
      <label>Tags <input name="tags" autocomplete="off" placeholder="texture, motion, ui"></label>
      <label>Note <textarea name="note" rows="2" placeholder="Optional note"></textarea></label>
      <div class="picker-row">
        <button class="picker-save" type="submit">Save</button>
        <button class="picker-save-visible" type="button">Save visible</button>
        <button class="picker-cancel" type="button">Never mind</button>
      </div>
      <div class="picker-row picker-row-status">
        <span class="picker-status"></span>
      </div>
      <div class="batch-results" role="status" aria-live="polite"></div>
      <p class="setup-hint"></p>
    `;
    picker.addEventListener("click", (event) => event.stopPropagation());
    marker.append(picker);

    const framePicker =
      picker.querySelector<HTMLDivElement>("[data-frame-picker]");
    const status = picker.querySelector<HTMLSpanElement>(".picker-status");
    const setupHint = picker.querySelector<HTMLParagraphElement>(".setup-hint");
    const batchResults =
      picker.querySelector<HTMLDivElement>(".batch-results");
    const saveButton = picker.querySelector<HTMLButtonElement>(".picker-save");
    const saveVisibleButton =
      picker.querySelector<HTMLButtonElement>(".picker-save-visible");
    const cancelButton =
      picker.querySelector<HTMLButtonElement>(".picker-cancel");
    const selectAllButton =
      picker.querySelector<HTMLButtonElement>(".frame-select-all");
    const selectNoneButton =
      picker.querySelector<HTMLButtonElement>(".frame-select-none");
    if (
      !framePicker ||
      !status ||
      !setupHint ||
      !batchResults ||
      !saveButton ||
      !saveVisibleButton ||
      !cancelButton ||
      !selectAllButton ||
      !selectNoneButton
    ) {
      return;
    }
    cancelButton.addEventListener("click", () => {
      this.closePicker();
    });

    status.textContent = "Loading Frames";
    const frameState = await this.loadFrames();
    if (this.openCandidateId !== candidate.id || !picker.isConnected) {
      return;
    }
    if (frameState.ok) {
      const frameChoices = frameChoicesFromState(frameState);
      renderFrameChoices(framePicker, frameChoices);
      status.textContent =
        frameState.frames.length > 0 ? "Ready" : "Inbox will be created";
      setupHint.textContent = "";
      saveButton.disabled = false;
      saveVisibleButton.disabled = false;
      selectAllButton.disabled = false;
      selectNoneButton.disabled = frameChoices.length <= 1;
    } else {
      renderFrameChoices(framePicker, [defaultInboxChoice()]);
      setFrameChoicesDisabled(framePicker, true);
      saveButton.disabled = true;
      saveVisibleButton.disabled = true;
      selectAllButton.disabled = true;
      selectNoneButton.disabled = true;
      status.textContent = frameState.message;
      setupHint.textContent = frameState.setupHint;
    }

    selectAllButton.addEventListener("click", () => {
      setAllFrameChoices(framePicker, true);
    });
    selectNoneButton.addEventListener("click", () => {
      setAllFrameChoices(framePicker, false);
    });

    const formValues = () => {
      const form = new FormData(picker);
      return {
        frameIds: selectedFrameIds(framePicker),
        note: String(form.get("note") ?? "").trim(),
        tags: parseTagsInput(String(form.get("tags") ?? "")),
      };
    };

    const setBusy = (busy: boolean) => {
      saveButton.disabled = busy || !frameState.ok;
      saveVisibleButton.disabled = busy || !frameState.ok;
      cancelButton.disabled = false;
      setFrameChoicesDisabled(framePicker, busy || !frameState.ok);
      selectAllButton.disabled = busy || !frameState.ok;
      selectNoneButton.disabled =
        busy || !frameState.ok || framePickerCheckboxes(framePicker).length <= 1;
    };

    let singleRetryCandidates: ImageCandidate[] | undefined;
    let visibleRetryCandidates: ImageCandidate[] | undefined;

    picker.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!frameState.ok) {
        return;
      }

      status.textContent = "Saving";
      setBusy(true);
      marker.classList.add("saving");
      const { frameIds, note, tags } = formValues();
      if (frameIds.length === 0) {
        status.textContent = "Select at least one Frame";
        marker.classList.remove("saving");
        setBusy(false);
        return;
      }
      const result = await this.saveCandidatesToFrames(
        singleRetryCandidates ?? [candidate],
        frameIds,
        note,
        tags,
        status,
        setupHint,
        batchResults,
        () => picker.isConnected,
      );
      if (!result.ok) {
        return;
      }
      marker.classList.remove("saving");
      status.textContent = batchSummary(
        result.saved,
        result.existing,
        result.attempted,
        result.failures,
      );
      if (result.failures > 0) {
        singleRetryCandidates = result.failedCandidates;
        saveButton.textContent = `Retry ${result.failures} failed`;
        setBusy(false);
        return;
      }

      singleRetryCandidates = undefined;
      marker.classList.add("saved");
      window.setTimeout(() => {
        if (this.saveBatchToken === result.batchToken) {
          picker.remove();
          marker.classList.remove("is-open");
          if (this.openCandidateId === candidate.id) {
            this.openCandidateId = undefined;
          }
          this.updateMarker(marker, candidate);
        }
      }, 900);
    });

    saveVisibleButton.addEventListener("click", async () => {
      if (!frameState.ok) {
        return;
      }
      const visibleCandidates =
        visibleRetryCandidates ?? this.viewportCandidates(80);
      if (visibleCandidates.length === 0) {
        status.textContent = "No visible images";
        return;
      }

      const { frameIds, note, tags } = formValues();
      if (frameIds.length === 0) {
        status.textContent = "Select at least one Frame";
        marker.classList.remove("saving");
        return;
      }
      setBusy(true);
      marker.classList.add("saving");
      const result = await this.saveCandidatesToFrames(
        visibleCandidates,
        frameIds,
        note,
        tags,
        status,
        setupHint,
        batchResults,
        () => picker.isConnected,
      );
      if (!result.ok) {
        return;
      }

      marker.classList.remove("saving");
      status.textContent = batchSummary(
        result.saved,
        result.existing,
        result.attempted,
        result.failures,
      );
      if (result.failures > 0) {
        visibleRetryCandidates = result.failedCandidates;
        saveVisibleButton.textContent = `Retry ${result.failures} failed`;
        setBusy(false);
        return;
      }

      visibleRetryCandidates = undefined;
      marker.classList.add("saved");
      window.setTimeout(() => {
        if (this.saveBatchToken === result.batchToken) {
          this.closePicker();
        }
      }, 1100);
    });
  }

  private async openBatchPicker() {
    this.closePicker();
    const visibleCandidates = this.viewportCandidates(80);
    if (visibleCandidates.length === 0) {
      return;
    }

    const tray = this.shadow.querySelector<HTMLDivElement>(".multi-tray");
    if (!tray) {
      return;
    }

    tray.querySelector(".batch-picker")?.remove();
    const picker = document.createElement("form");
    picker.className = "batch-picker";
    picker.innerHTML = `
      <div class="picker-header">
        <strong>Save visible Fragments</strong>
        <span>${visibleCandidates.length} detected in this viewport</span>
      </div>
      <div class="frame-picker-shell">
        <div class="frame-picker-heading">
          <span>Frames</span>
          <div class="frame-picker-actions">
            <button class="frame-select-all" type="button">Select all</button>
            <button class="frame-select-none" type="button">Deselect</button>
          </div>
        </div>
        <div class="frame-picker" data-frame-picker></div>
      </div>
      <label>Tags <input name="tags" autocomplete="off" placeholder="texture, motion, ui"></label>
      <label>Note <textarea name="note" rows="2" placeholder="Optional note"></textarea></label>
      <div class="picker-row">
        <button class="picker-save" type="submit">Save ${visibleCandidates.length}</button>
        <button class="picker-cancel" type="button">Never mind</button>
      </div>
      <div class="picker-row picker-row-status">
        <span class="picker-status"></span>
      </div>
      <div class="batch-results" role="status" aria-live="polite"></div>
      <p class="setup-hint"></p>
    `;
    picker.addEventListener("click", (event) => event.stopPropagation());
    tray.append(picker);

    const framePicker =
      picker.querySelector<HTMLDivElement>("[data-frame-picker]");
    const status = picker.querySelector<HTMLSpanElement>(".picker-status");
    const setupHint = picker.querySelector<HTMLParagraphElement>(".setup-hint");
    const batchResults =
      picker.querySelector<HTMLDivElement>(".batch-results");
    const saveButton = picker.querySelector<HTMLButtonElement>(".picker-save");
    const cancelButton =
      picker.querySelector<HTMLButtonElement>(".picker-cancel");
    const selectAllButton =
      picker.querySelector<HTMLButtonElement>(".frame-select-all");
    const selectNoneButton =
      picker.querySelector<HTMLButtonElement>(".frame-select-none");
    if (
      !framePicker ||
      !status ||
      !setupHint ||
      !batchResults ||
      !saveButton ||
      !cancelButton ||
      !selectAllButton ||
      !selectNoneButton
    ) {
      return;
    }

    cancelButton.addEventListener("click", () => this.closePicker());

    status.textContent = "Loading Frames";
    const frameState = await this.loadFrames();
    if (!picker.isConnected) {
      return;
    }
    if (frameState.ok) {
      const frameChoices = frameChoicesFromState(frameState);
      renderFrameChoices(framePicker, frameChoices);
      status.textContent = "Ready";
      setupHint.textContent = "";
      saveButton.disabled = false;
      selectAllButton.disabled = false;
      selectNoneButton.disabled = frameChoices.length <= 1;
    } else {
      renderFrameChoices(framePicker, [defaultInboxChoice()]);
      setFrameChoicesDisabled(framePicker, true);
      saveButton.disabled = true;
      selectAllButton.disabled = true;
      selectNoneButton.disabled = true;
      status.textContent = frameState.message;
      setupHint.textContent = frameState.setupHint;
    }

    selectAllButton.addEventListener("click", () => {
      setAllFrameChoices(framePicker, true);
      saveButton.textContent = saveBatchButtonLabel(
        visibleCandidates.length,
        selectedFrameIds(framePicker).length,
      );
    });
    selectNoneButton.addEventListener("click", () => {
      setAllFrameChoices(framePicker, false);
      saveButton.textContent = saveBatchButtonLabel(
        visibleCandidates.length,
        selectedFrameIds(framePicker).length,
      );
    });
    framePicker.addEventListener("change", () => {
      saveButton.textContent = saveBatchButtonLabel(
        visibleCandidates.length,
        selectedFrameIds(framePicker).length,
      );
    });
    saveButton.textContent = saveBatchButtonLabel(
      visibleCandidates.length,
      selectedFrameIds(framePicker).length,
    );
    let pendingCandidates = visibleCandidates;

    picker.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!frameState.ok) {
        return;
      }

      const form = new FormData(picker);
      const frameIds = selectedFrameIds(framePicker);
      const note = String(form.get("note") ?? "").trim();
      const tags = parseTagsInput(String(form.get("tags") ?? ""));
      if (frameIds.length === 0) {
        status.textContent = "Select at least one Frame";
        return;
      }
      saveButton.disabled = true;
      cancelButton.disabled = false;
      selectAllButton.disabled = true;
      selectNoneButton.disabled = true;
      setFrameChoicesDisabled(framePicker, true);

      const result = await this.saveCandidatesToFrames(
        pendingCandidates,
        frameIds,
        note,
        tags,
        status,
        setupHint,
        batchResults,
        () => picker.isConnected,
      );
      if (!result.ok) {
        return;
      }

      status.textContent = batchSummary(
        result.saved,
        result.existing,
        result.attempted,
        result.failures,
      );
      if (result.failures > 0) {
        pendingCandidates = result.failedCandidates;
        saveButton.textContent = `Retry ${result.failures} failed`;
        saveButton.disabled = false;
        selectAllButton.disabled = false;
        selectNoneButton.disabled =
          framePickerCheckboxes(framePicker).length <= 1;
        setFrameChoicesDisabled(framePicker, false);
        return;
      }

      window.setTimeout(() => {
        if (this.saveBatchToken === result.batchToken) {
          picker.remove();
        }
      }, 1100);
    });
  }

  private async saveCandidatesToFrames(
    candidates: ImageCandidate[],
    frameIds: string[],
    note: string,
    tags: string[],
    status: HTMLElement,
    setupHint: HTMLElement,
    resultsContainer: HTMLElement,
    isConnected: () => boolean,
  ): Promise<SaveBatchResult> {
    const batchToken = this.saveBatchToken + 1;
    this.saveBatchToken = batchToken;
    const total = candidates.length * frameIds.length;
    const isCancelled = () =>
      this.saveBatchToken !== batchToken || !isConnected();
    const result = await runCaptureBatch({
      candidates,
      isCancelled,
      send: (candidate) => this.saveCandidate(candidate, frameIds, note, tags),
      onProgress: ({ completed, total: candidateTotal }) => {
        if (isCancelled()) {
          return;
        }
        const completedRelations = Math.min(
          (completed + 1) * frameIds.length,
          total,
        );
        status.textContent =
          frameIds.length > 1
            ? `Saving ${completedRelations}/${total} · ${frameIds.length} Frames`
            : `Saving ${Math.min(completed + 1, candidateTotal)}/${candidateTotal}`;
      },
    });

    if (result.cancelled || isCancelled()) {
      return { ok: false, cancelled: true };
    }

    renderCaptureBatchResults(resultsContainer, result.items);
    const unavailableItem = result.items.find(
      (item) => item.error?.code === "native_host_unavailable",
    );
    setupHint.textContent = unavailableItem ? nativeHostSetupHint() : "";
    return {
      ok: true,
      saved: result.saved,
      existing: result.existing,
      failures: result.failures,
      attempted: result.items.length * frameIds.length,
      batchToken,
      failedCandidates: result.failedCandidates,
      items: result.items,
    };
  }

  private async saveCandidate(
    candidate: ImageCandidate,
    frameIds: string[],
    note: string,
    tags: string[],
  ): Promise<BackgroundReply> {
    const payload: CaptureFragmentRequest = {
      type: "capture.fragment",
      requestId: requestId("capture"),
      frameId: frameIds[0] || null,
      frameIds,
      candidate,
      requestedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
    };
    if (note) {
      payload.note = note;
    }
    if (tags.length > 0) {
      payload.tags = tags;
    }

    return (await chrome.runtime.sendMessage({
      type: "fragment.capture.save",
      payload,
    })) as BackgroundReply;
  }

  private async loadFrames(): Promise<FrameLoadState> {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "fragment.frames.list",
        requestId: requestId("frames"),
      })) as BackgroundReply;
      if (response.ok && Array.isArray(response.payload)) {
        return { ok: true, frames: response.payload as Frame[] };
      }
      return {
        ok: false,
        message: response.ok ? "Could not load Frames" : response.error.message,
        setupHint:
          !response.ok && response.error.code === "native_host_unavailable"
            ? nativeHostSetupHint()
            : "Open Fragment, then try again.",
      };
    } catch (error) {
      return {
        ok: false,
        message: "Could not reach Fragment",
        setupHint:
          error instanceof Error ? error.message : nativeHostSetupHint(),
      };
    }
  }
}

export function parseTagsInput(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const rawTag of value.split(",")) {
    const tag = rawTag.trim().replace(/^#+/, "");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function defaultInboxChoice(): FrameChoice {
  return { id: "", name: "Inbox" };
}

function frameChoicesFromState(state: { frames: Frame[] }): FrameChoice[] {
  return state.frames.length > 0
    ? state.frames.map((frame) => ({ id: frame.id, name: frame.name }))
    : [defaultInboxChoice()];
}

function renderFrameChoices(container: HTMLElement, choices: FrameChoice[]) {
  container.replaceChildren(
    ...choices.map((choice, index) => {
      const label = document.createElement("label");
      label.className = "frame-choice";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "frameIds";
      input.value = choice.id;
      input.checked = index === 0;

      const text = document.createElement("span");
      text.textContent = choice.name;

      label.append(input, text);
      return label;
    }),
  );
}

function framePickerCheckboxes(container: HTMLElement): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[name="frameIds"]'),
  );
}

function selectedFrameIds(container: HTMLElement): string[] {
  return framePickerCheckboxes(container)
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function setAllFrameChoices(container: HTMLElement, checked: boolean) {
  for (const input of framePickerCheckboxes(container)) {
    input.checked = checked;
  }
}

function setFrameChoicesDisabled(container: HTMLElement, disabled: boolean) {
  for (const input of framePickerCheckboxes(container)) {
    input.disabled = disabled;
  }
}

function renderCaptureBatchResults(
  container: HTMLElement,
  items: CaptureBatchItemResult[],
) {
  container.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("div");
      row.className = `batch-result is-${item.status}`;

      const title = document.createElement("span");
      title.className = "batch-result-title";
      title.textContent =
        item.candidate.title ??
        item.candidate.alt ??
        sourceHost(item.candidate.src);

      const state = document.createElement("span");
      state.className = "batch-result-state";
      state.textContent =
        item.status === "failed"
          ? item.error?.message ?? "Failed"
          : item.status === "existing"
            ? "Already saved"
            : "Saved";
      row.append(title, state);
      return row;
    }),
  );
}

export function saveBatchButtonLabel(
  imageCount: number,
  frameCount: number,
): string {
  if (frameCount > 1) {
    return `Save ${imageCount} to ${frameCount} Frames`;
  }
  return `Save ${imageCount}`;
}

function nativeHostSetupHint(): string {
  const extensionId = chrome.runtime.id;
  return `Native host is not connected. Build the host, then run scripts/install-native-host-macos.sh ${extensionId}.`;
}

function sourceHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function batchSummary(
  saved: number,
  existing: number,
  attempted = saved + existing,
  failures = 0,
): string {
  if (failures > 0) {
    const parts: string[] = [];
    if (saved > 0) {
      parts.push(`Saved ${saved}`);
    }
    if (existing > 0) {
      parts.push(`${existing} already existed`);
    }
    parts.push(`${failures} failed`);
    return parts.join(", ");
  }
  if (existing > 0 && saved === 0) {
    return attempted > 1
      ? `Already saved in ${existing} places`
      : "Already saved";
  }
  if (existing > 0) {
    return `Saved ${saved}, ${existing} already existed`;
  }
  return `Saved ${saved}`;
}

const styles = `
  :host {
    color-scheme: dark;
    --fg: #f7f7f4;
    --muted: rgba(247, 247, 244, 0.62);
    --line: rgba(255, 255, 255, 0.14);
    --glass: rgba(18, 18, 18, 0.74);
    --glass-strong: rgba(16, 16, 16, 0.94);
    --accent: #89f7ff;
    --neon: #b9ff68;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", system-ui, sans-serif;
  }
  .layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }
  .multi-tray {
    position: fixed;
    left: 50%;
    bottom: 18px;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 44px;
    padding: 6px 7px 6px 13px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.045)),
      var(--glass);
    color: var(--fg);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      0 18px 48px rgba(0, 0, 0, 0.32);
    pointer-events: auto;
    transform: translateX(-50%);
    -webkit-backdrop-filter: blur(24px) saturate(1.22);
    backdrop-filter: blur(24px) saturate(1.22);
  }
  .multi-tray[hidden] {
    display: none;
  }
  .tray-count {
    color: var(--muted);
    font-size: 12px;
    font-weight: 820;
    white-space: nowrap;
  }
  .tray-save-visible {
    min-height: 32px;
    padding: 0 13px;
    border: 1px solid rgba(137, 247, 255, 0.26);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04)),
      rgba(0, 0, 0, 0.32);
    color: var(--fg);
    cursor: pointer;
    font-size: 12px;
    font-weight: 860;
    white-space: nowrap;
  }
  .marker {
    position: fixed;
    pointer-events: none;
  }
  .save-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 16px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05)),
      rgba(8, 8, 8, 0.82);
    color: var(--fg);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      0 12px 34px rgba(0, 0, 0, 0.36),
      0 0 0 1px rgba(137, 247, 255, 0.08);
    cursor: pointer;
    font-size: 12px;
    font-weight: 820;
    line-height: 1;
    pointer-events: auto;
    white-space: nowrap;
    -webkit-backdrop-filter: blur(18px) saturate(1.18);
    backdrop-filter: blur(18px) saturate(1.18);
    animation: marker-in 140ms ease-out both;
  }
  .fragment-logo {
    display: block;
    width: 27px;
    height: 27px;
    border-radius: 7px;
    object-fit: contain;
  }
  .save-label {
    display: none;
  }
  .marker.is-open .save-button,
  .save-button:hover {
    border-color: rgba(137, 247, 255, 0.42);
    color: white;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.25),
      0 16px 42px rgba(0, 0, 0, 0.46),
      0 0 26px rgba(137, 247, 255, 0.14);
  }
  .marker.is-open .save-button {
    width: auto;
    height: 40px;
    padding: 0 13px 0 9px;
    border-radius: 999px;
  }
  .marker.is-open .save-label {
    display: inline;
  }
  .saved > .save-button {
    border-color: rgba(185, 255, 104, 0.44);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      0 16px 42px rgba(0, 0, 0, 0.42),
      0 0 28px rgba(185, 255, 104, 0.18);
  }
  .picker,
  .batch-picker {
    display: grid;
    gap: 10px;
    width: min(292px, calc(100vw - 22px));
    max-height: min(520px, calc(100vh - 34px));
    margin-top: 8px;
    padding: 14px;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--line);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.035)),
      var(--glass-strong);
    color: var(--fg);
    pointer-events: auto;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.16),
      0 22px 70px rgba(0, 0, 0, 0.5);
    -webkit-backdrop-filter: blur(26px) saturate(1.18);
    backdrop-filter: blur(26px) saturate(1.18);
  }
  .batch-picker {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 10px);
    transform: translateX(-50%);
  }
  .picker-header {
    display: grid;
    gap: 2px;
  }
  .picker-header strong {
    font-size: 14px;
    font-weight: 860;
  }
  .picker-header span,
  .setup-hint {
    min-width: 0;
    color: var(--muted);
    font-size: 11px;
    font-weight: 680;
    line-height: 1.35;
  }
  .frame-picker-shell {
    display: grid;
    gap: 7px;
  }
  .frame-picker-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: rgba(247, 247, 244, 0.7);
    font-size: 11px;
    font-weight: 820;
  }
  .frame-picker-actions {
    display: flex;
    gap: 6px;
  }
  .frame-picker-actions button {
    min-height: 24px;
    padding: 0 8px;
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.055);
    color: var(--muted);
    cursor: pointer;
    font-size: 10px;
    font-weight: 800;
  }
  .frame-picker {
    display: grid;
    gap: 6px;
    max-height: 138px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px;
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.18);
  }
  .frame-choice {
    display: flex;
    grid-template-columns: none;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 6px 8px;
    border-radius: 9px;
    color: var(--fg);
    font-size: 12px;
    font-weight: 760;
  }
  .frame-choice:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .frame-choice input {
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
    min-height: 0;
    margin: 0;
    accent-color: var(--accent);
  }
  .frame-choice span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  label {
    display: grid;
    gap: 6px;
    color: rgba(247, 247, 244, 0.7);
    font-size: 11px;
    font-weight: 820;
  }
  select,
  input,
  textarea {
    width: 100%;
    min-height: 36px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.025)),
      rgba(0, 0, 0, 0.32);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    padding: 8px 10px;
    outline: none;
  }
  textarea {
    min-height: 62px;
    resize: vertical;
  }
  select:disabled,
  button:disabled {
    cursor: not-allowed;
    opacity: 0.56;
  }
  .picker-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px;
  }
  .picker-row-status {
    min-height: 16px;
  }
  .picker-save {
    min-height: 34px;
    padding: 0 15px;
    border: 1px solid rgba(185, 255, 104, 0.34);
    border-radius: 999px;
    background: linear-gradient(180deg, var(--neon), #8eee4f);
    color: #061206;
    cursor: pointer;
    font-size: 12px;
    font-weight: 860;
  }
  .picker-save-visible,
  .picker-cancel {
    min-height: 34px;
    padding: 0 13px;
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.035)),
      rgba(0, 0, 0, 0.26);
    color: var(--fg);
    cursor: pointer;
    font-size: 12px;
    font-weight: 820;
  }
  .picker-cancel {
    color: var(--muted);
  }
  .picker-status {
    min-width: 0;
    color: var(--accent);
    font-size: 11px;
    font-weight: 820;
    line-height: 1.25;
  }
  .batch-results {
    display: grid;
    gap: 5px;
    max-height: 112px;
    overflow-y: auto;
  }
  .batch-results:empty {
    display: none;
  }
  .batch-result {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 5px 7px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.035);
    font-size: 10px;
  }
  .batch-result-title {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .batch-result-state {
    color: var(--accent);
    font-weight: 820;
  }
  .batch-result.is-failed .batch-result-state {
    color: #ff9d99;
  }
  .setup-hint {
    margin: 0;
    color: rgba(255, 255, 255, 0.56);
    word-break: break-word;
  }

  /* Paper Capture system — on-page UI stays solid dark for reliable contrast. */
  :host {
    --canvas: #080a0a;
    --canvas-soft: #111413;
    --surface: rgba(26, 29, 27, 0.94);
    --surface-strong: #202421;
    --hover: rgba(44, 50, 46, 0.9);
    --line: rgba(255, 255, 255, 0.105);
    --line-strong: rgba(255, 255, 255, 0.18);
    --fg: #f4f7f2;
    --muted: #b3bab0;
    --faint: #7f887f;
    --accent: #89f7ff;
    --primary: #79e1a2;
    --on-primary: #061b11;
    --danger: #f27b72;
  }
  button:focus-visible,
  input:focus-visible,
  textarea:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .multi-tray {
    min-height: 52px;
    gap: 8px;
    padding: 6px 6px 6px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface-strong);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .tray-summary {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding-left: 2px;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .tray-count {
    display: grid;
    min-width: 30px;
    height: 30px;
    place-items: center;
    border-radius: 999px;
    background: var(--canvas-soft);
    color: var(--fg);
    font-size: 12px;
    font-weight: 700;
  }
  .tray-save-visible {
    min-height: 38px;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 12px;
    font-weight: 700;
  }
  .tray-save-visible:hover { background: #8ce8ad; }
  .tray-close,
  .picker-cancel {
    display: grid;
    width: 34px;
    height: 34px;
    min-height: 0;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--canvas-soft);
    color: var(--muted);
    cursor: pointer;
  }
  .tray-close:hover,
  .picker-cancel:hover { background: var(--hover); color: var(--fg); }
  .tray-close svg,
  .picker-cancel svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .save-button {
    width: 44px;
    height: 44px;
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    background: var(--surface-strong);
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.44);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .capture-mark {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 7px;
    background: var(--primary);
    color: var(--on-primary);
  }
  .capture-mark svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linejoin: round;
  }
  .marker.is-open .save-button,
  .save-button:hover {
    border-color: var(--accent);
    background: var(--surface-strong);
    box-shadow: 0 14px 38px rgba(0, 0, 0, 0.48);
  }
  .marker.is-open .save-button {
    height: 40px;
    padding: 0 12px 0 8px;
    border-radius: 999px;
  }
  .save-label { font-size: 12px; font-weight: 680; }
  .saving > .save-button { border-color: var(--accent); }
  .saved > .save-button { border-color: var(--primary); box-shadow: 0 14px 38px rgba(0, 0, 0, 0.48); }
  .picker,
  .batch-picker {
    width: min(364px, calc(100vw - 20px));
    max-height: min(610px, calc(100vh - 24px));
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    background: var(--surface-strong);
    box-shadow: 0 24px 72px rgba(0, 0, 0, 0.56);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .batch-picker { width: min(408px, calc(100vw - 20px)); }
  .picker-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .picker-header > div { display: grid; min-width: 0; gap: 3px; }
  .picker-header strong { font-size: 16px; font-weight: 700; letter-spacing: -0.2px; }
  .picker-header span { overflow: hidden; color: var(--muted); font-size: 11px; line-height: 15px; text-overflow: ellipsis; white-space: nowrap; }
  .frame-picker-shell { gap: 8px; }
  .frame-picker-heading {
    color: var(--faint);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .frame-picker-actions { gap: 8px; }
  .frame-picker-actions button {
    min-height: 24px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    font-size: 10px;
    text-transform: none;
    letter-spacing: 0;
  }
  .frame-picker-actions button:hover { color: var(--fg); }
  .frame-picker {
    max-height: 168px;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--canvas-soft);
  }
  .frame-choice {
    display: grid;
    grid-template-columns: 18px 24px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 0 9px;
    border-radius: 8px;
    color: var(--fg);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .frame-choice:has(input:checked) { background: var(--hover); }
  .frame-choice input {
    width: 16px;
    height: 16px;
    accent-color: var(--primary);
  }
  .frame-choice-icon {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 6px;
    background: rgba(121, 225, 162, 0.1);
    color: var(--primary);
  }
  .frame-choice-icon svg,
  .source-note svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .frame-choice-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picker-field { display: grid; gap: 7px; color: var(--faint); font-size: 10px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase; }
  .picker-field input,
  .note-field textarea {
    min-height: 38px;
    padding: 0 11px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--canvas-soft);
    color: var(--fg);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }
  .picker-field input::placeholder,
  .note-field textarea::placeholder { color: var(--faint); }
  .note-field {
    display: grid;
    gap: 8px;
    color: var(--muted);
  }
  .note-field summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    list-style: none;
  }
  .note-field summary::-webkit-details-marker { display: none; }
  .note-field summary::before { content: "+"; margin-right: 7px; color: var(--primary); }
  .note-field summary span { margin-left: auto; color: var(--faint); font-size: 10px; font-weight: 500; }
  .note-field textarea { min-height: 64px; padding: 9px 11px; resize: vertical; }
  .picker-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  .batch-picker .picker-actions { grid-template-columns: 1fr; }
  .picker-save,
  .picker-save-visible {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
  }
  .picker-save {
    border: 1px solid transparent;
    background: var(--primary);
    color: var(--on-primary);
  }
  .picker-save:hover { background: #8ce8ad; }
  .picker-save-visible {
    border: 1px solid var(--line-strong);
    background: var(--canvas-soft);
    color: var(--fg);
  }
  .picker-save-visible:hover { background: var(--hover); }
  .picker-row-status { min-height: 0; }
  .picker-status { color: var(--accent); font-size: 11px; font-weight: 600; }
  .picker-status:empty,
  .setup-hint:empty { display: none; }
  .setup-hint { color: var(--danger); font-size: 10px; line-height: 14px; }
  .source-note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--faint);
    font-size: 10px;
    line-height: 14px;
  }
  .source-note svg { width: 14px; height: 14px; flex: 0 0 auto; }
  .preview-strip {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 5px;
    height: 64px;
  }
  .preview-strip img,
  .preview-strip > span {
    width: 100%;
    height: 64px;
    border: 1px solid var(--line);
    border-radius: 8px;
    object-fit: cover;
    background: var(--canvas-soft);
  }
  .preview-strip > span { display: grid; place-items: center; color: var(--muted); font-size: 11px; font-weight: 700; }
  .batch-results { max-height: 96px; gap: 4px; }
  .batch-result { min-height: 30px; border-color: var(--line); background: var(--canvas-soft); }
  .batch-result-state { color: var(--primary); }
  .batch-result.is-failed .batch-result-state { color: var(--danger); }

  /* Preserve the existing Capture geometry and behavior; update appearance only. */
  .multi-tray {
    min-height: 44px;
    gap: 9px;
    padding: 6px 7px 6px 13px;
  }
  .tray-count {
    display: inline;
    min-width: 0;
    height: auto;
    padding: 0;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
  }
  .tray-save-visible {
    min-height: 32px;
    padding: 0 13px;
  }
  .picker-cancel {
    display: inline-flex;
    width: auto;
    height: auto;
    min-height: 34px;
    padding: 0 13px;
    border-radius: 8px;
  }
  .picker,
  .batch-picker {
    width: min(292px, calc(100vw - 22px));
    max-height: min(520px, calc(100vh - 34px));
    gap: 10px;
    padding: 14px;
  }
  .picker-header {
    display: grid;
    gap: 2px;
  }
  .picker-header span {
    white-space: normal;
  }
  .frame-picker {
    gap: 6px;
    max-height: 138px;
    padding: 4px;
  }
  .frame-choice {
    display: flex;
    grid-template-columns: none;
    gap: 8px;
    min-height: 30px;
    padding: 6px 8px;
  }
  label {
    color: var(--muted);
  }
  select,
  input,
  textarea {
    border-color: var(--line);
    border-radius: 8px;
    background: var(--canvas-soft);
  }
  .picker-row-status {
    min-height: 16px;
  }

  @keyframes marker-in {
    from {
      opacity: 0;
      transform: translateY(5px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;
