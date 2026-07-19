import type {
  CaptureFragmentRequest,
  Frame,
  ImageCandidate,
} from "@fragment/shared";
import { requestId, type BackgroundReply } from "../shared/messages";

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
      attempted: number;
      batchToken: number;
    }
  | { ok: false };

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
      if (!this.openCandidateId || this.isEventInsideOpenMarker(event)) {
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

  private isEventInsideOpenMarker(event: Event) {
    if (!this.openCandidateId) {
      return false;
    }
    return event.composedPath().some((node) => {
      return (
        node instanceof HTMLElement &&
        node.classList.contains("marker") &&
        node.dataset.candidateId === this.openCandidateId
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
    this.shadow.querySelectorAll(".marker").forEach((marker) => {
      marker.classList.remove("is-open");
      marker.classList.remove("saved");
    });
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
      <p class="setup-hint"></p>
    `;
    picker.addEventListener("click", (event) => event.stopPropagation());
    marker.append(picker);

    const framePicker =
      picker.querySelector<HTMLDivElement>("[data-frame-picker]");
    const status = picker.querySelector<HTMLSpanElement>(".picker-status");
    const setupHint = picker.querySelector<HTMLParagraphElement>(".setup-hint");
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
      cancelButton.disabled = busy;
      setFrameChoicesDisabled(framePicker, busy || !frameState.ok);
      selectAllButton.disabled = busy || !frameState.ok;
      selectNoneButton.disabled =
        busy || !frameState.ok || framePickerCheckboxes(framePicker).length <= 1;
    };

    picker.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!frameState.ok) {
        return;
      }

      status.textContent = "Saving";
      setBusy(true);
      const { frameIds, note, tags } = formValues();
      if (frameIds.length === 0) {
        status.textContent = "Select at least one Frame";
        setBusy(false);
        return;
      }
      const result = await this.saveCandidatesToFrames(
        [candidate],
        frameIds,
        note,
        tags,
        status,
        setupHint,
        () => picker.isConnected,
      );
      if (result.ok) {
        status.textContent = batchSummary(
          result.saved,
          result.existing,
          result.attempted,
        );
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
      } else {
        setBusy(false);
      }
    });

    saveVisibleButton.addEventListener("click", async () => {
      if (!frameState.ok) {
        return;
      }
      const visibleCandidates = this.viewportCandidates(80);
      if (visibleCandidates.length === 0) {
        status.textContent = "No visible images";
        return;
      }

      const { frameIds, note, tags } = formValues();
      if (frameIds.length === 0) {
        status.textContent = "Select at least one Frame";
        return;
      }
      setBusy(true);
      const result = await this.saveCandidatesToFrames(
        visibleCandidates,
        frameIds,
        note,
        tags,
        status,
        setupHint,
        () => picker.isConnected,
      );
      if (!result.ok) {
        setBusy(false);
        return;
      }

      marker.classList.add("saved");
      status.textContent = batchSummary(
        result.saved,
        result.existing,
        result.attempted,
      );
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
      <p class="setup-hint"></p>
    `;
    picker.addEventListener("click", (event) => event.stopPropagation());
    tray.append(picker);

    const framePicker =
      picker.querySelector<HTMLDivElement>("[data-frame-picker]");
    const status = picker.querySelector<HTMLSpanElement>(".picker-status");
    const setupHint = picker.querySelector<HTMLParagraphElement>(".setup-hint");
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
      !saveButton ||
      !cancelButton ||
      !selectAllButton ||
      !selectNoneButton
    ) {
      return;
    }

    const closeBatchPicker = () => {
      this.saveBatchToken += 1;
      picker.remove();
    };
    cancelButton.addEventListener("click", closeBatchPicker);

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
      cancelButton.disabled = true;
      selectAllButton.disabled = true;
      selectNoneButton.disabled = true;
      setFrameChoicesDisabled(framePicker, true);

      const result = await this.saveCandidatesToFrames(
        visibleCandidates,
        frameIds,
        note,
        tags,
        status,
        setupHint,
        () => picker.isConnected,
      );
      if (!result.ok) {
        saveButton.disabled = false;
        cancelButton.disabled = false;
        selectAllButton.disabled = false;
        selectNoneButton.disabled = framePickerCheckboxes(framePicker).length <= 1;
        setFrameChoicesDisabled(framePicker, false);
        return;
      }

      status.textContent = batchSummary(
        result.saved,
        result.existing,
        result.attempted,
      );
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
    isConnected: () => boolean,
  ): Promise<SaveBatchResult> {
    const batchToken = this.saveBatchToken + 1;
    this.saveBatchToken = batchToken;
    let saved = 0;
    let existing = 0;
    const total = candidates.length * frameIds.length;
    let attempted = 0;

    for (const [index, item] of candidates.entries()) {
      if (this.saveBatchToken !== batchToken || !isConnected()) {
        return { ok: false };
      }
      attempted += frameIds.length;
      status.textContent =
        frameIds.length > 1
          ? `Saving ${attempted}/${total} · ${frameIds.length} Frames`
          : `Saving ${index + 1}/${candidates.length}`;
      const response = await this.saveCandidate(item, frameIds, note, tags);
      if (!response.ok) {
        status.textContent = response.error.message;
        setupHint.textContent =
          response.error.code === "native_host_unavailable"
            ? nativeHostSetupHint()
            : "";
        return { ok: false };
      }
      const result = response.payload as
        | {
            duplicateOfFragmentId?: string;
            duplicateOfFragmentIds?: string[];
            fragmentId?: string;
            fragmentIds?: string[];
          }
        | undefined;
      existing +=
        result?.duplicateOfFragmentIds?.length ??
        (result?.duplicateOfFragmentId ? 1 : 0);
      saved +=
        result?.fragmentIds?.length ?? (result?.fragmentId ? 1 : 0);
    }

    return { ok: true, saved, existing, attempted, batchToken };
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
): string {
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
  .setup-hint {
    margin: 0;
    color: rgba(255, 255, 255, 0.56);
    word-break: break-word;
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
