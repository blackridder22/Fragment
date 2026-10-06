import type { Fragment, Frame, PaletteIndexStatus } from "@fragment/shared";
import type {
  FragmentFilter,
  SmartFrame,
} from "../features/filters/filter-model";
import type { FragmentContextMenuState } from "../features/fragments/FragmentContextMenu";
import type { FrameNavigatorPreferences } from "../features/frames/frame-tree";
import type { ImportQueueItem } from "../features/import/import-state";
import type { SelectionState } from "../features/selection/selection-model";
import type { PreviewTrashState } from "../features/trash/preview-trash-state";
import type { V7SettingsState } from "../v7/settings-state";

/** Top-level pages of the desktop shell. */
export type LibraryView = "home" | "frames" | "trash" | "settings";

export type SortMode = "newest" | "oldest" | "name" | "largest";
export type SourceFilter = "all" | "source" | "local" | "png";
export type BrowsingLayout = "masonry" | "grid" | "list";
export type BrowsingDensity = "compact" | "comfortable" | "large";
export type BrowsingMode = { layout: BrowsingLayout; density: BrowsingDensity };
export type TrashSort = "newest" | "oldest";
export type ThemePreference = "light" | "dark" | "system";
export type ThemeMode = Exclude<ThemePreference, "system">;
export type DeletePolicy = "forever" | "7" | "14" | "24" | "31";
export type TagLoadStatus = "loading" | "ready" | "error";
export type TrashDropState = "idle" | "armed" | "success";

export type NativeHostStatus = Readonly<{
  state: "ready" | "checking" | "unavailable" | "error" | "unknown";
  label: string;
  description?: string;
}>;

/** One server-backed page of Fragments (active library or Trash). */
export type PageState = {
  /** Serialized query key the items belong to; `null` means stale. */
  key: string | null;
  items: Fragment[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  paletteRevision: string | null;
};

export type FocusedFragment = {
  fragment: Fragment;
  mode: "preview" | "quick";
};

export type FrameModalState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; frame: Frame }
  | null;

export type ToastTone = "info" | "success" | "error";

export type ToastAction = {
  label: string;
  onAction: () => void | Promise<void>;
};

export type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  /** While true the toast stays open and the action is disabled. */
  pending: boolean;
  /** Auto-dismiss delay; `null` keeps it open until dismissed. */
  duration: number | null;
};

export type ConfirmRequest = {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
};

export type UndoEntry =
  | {
      kind: "fragments";
      ids: string[];
      /** Items removed from the active page, with their index, for re-insertion. */
      removed: Array<{ fragment: Fragment; index: number }>;
      pageKey: string | null;
    }
  | {
      kind: "frame";
      frameId: string;
      frames: Frame[];
      counts: Record<string, number>;
    }
  | { kind: "linked"; ids: string[] }
  | {
      /** Reverts an action the Trash page already applied locally (for example re-trashing a restore). */
      kind: "custom";
      run: () => Promise<void>;
      doneLabel: string;
    };

export type LibraryState = {
  booted: boolean;
  previewMode: boolean;
  assetRoot: string;
  defaultFrameId: string | null;
  revision: string;

  frames: Frame[];
  frameCounts: Record<string, number>;
  /** Snapshot Fragments used for folder collages on the home page. */
  coverFragments: Fragment[];
  smartFrames: SmartFrame[];
  knownTags: string[];
  trashTotal: number;
  trashedFrames: Frame[];
  /** False until the Trash page listed its Frames once; the snapshot only counts Fragments. */
  trashedFramesLoaded: boolean;

  activePage: PageState;
  trashPage: PageState;
  paletteIndex: PaletteIndexStatus | null;
  colorResultsChanged: boolean;

  view: LibraryView;
  selectedFrameId: string | null;
  selectedSmartFrameId: string | null;
  frameNavigator: FrameNavigatorPreferences;
  recentFrameId: string | null;
  query: string;
  sourceFilter: SourceFilter;
  sortMode: SortMode;
  fragmentFilter: FragmentFilter;
  trashSort: TrashSort;

  selection: SelectionState;
  focused: FocusedFragment | null;
  fragmentTagsById: Record<string, string[]>;
  fragmentTagStatusById: Record<string, TagLoadStatus>;
  contextMenu: FragmentContextMenuState | null;
  shortcutsOpen: boolean;
  frameModal: FrameModalState;

  theme: ThemePreference;
  systemPrefersDark: boolean;
  deletePolicy: DeletePolicy;
  settings: V7SettingsState;
  browsingMode: BrowsingMode;
  nativeHostStatus: NativeHostStatus;

  pendingImports: ImportQueueItem[];

  toast: ToastState | null;
  confirm: ConfirmRequest | null;
  error: string | null;
  undo: UndoEntry | null;
  undoPending: boolean;

  trashDropState: TrashDropState;
  frameDropTarget: string | null;

  previewTrashState: PreviewTrashState;
  previewFrameAssignments: Record<string, string>;
  previewTitleOverrides: Record<string, string>;
  assetDataUrls: Record<string, string>;
};
