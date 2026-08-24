export const SHORTCUT_ACTION_IDS = [
  "search",
  "importFrames",
  "quickPreview",
  "closeOverlay",
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];
export type ShortcutScope = "global" | "library" | "overlay";
export type ShortcutPlatform = "mac" | "windows" | "linux";

export type ShortcutBinding = Readonly<{
  code: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}>;

export type ShortcutBindingMap = Readonly<
  Partial<Record<ShortcutActionId, ShortcutBinding | null>>
>;

export type ShortcutDefinition = Readonly<{
  id: ShortcutActionId;
  label: string;
  description: string;
  scope: ShortcutScope;
  defaultBinding: ShortcutBinding;
}>;

export type KeyboardEventLike = Readonly<{
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}>;

export type ShortcutValidationCode =
  | "invalid-code"
  | "modifier-only"
  | "reserved-os"
  | "global-printable";

export type ShortcutValidationIssue = Readonly<{
  code: ShortcutValidationCode;
  message: string;
}>;

export type ShortcutConflict = Readonly<{
  signature: string;
  binding: ShortcutBinding;
  actionIds: readonly ShortcutActionId[];
}>;

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

const MOD_RESERVED_CODES = new Set([
  "KeyH",
  "KeyM",
  "KeyQ",
  "KeyW",
  "Space",
  "Tab",
]);

const CODE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  " ": "Space",
  alt: "AltLeft",
  altgraph: "AltRight",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  backspace: "Backspace",
  capslock: "CapsLock",
  control: "ControlLeft",
  ctrl: "ControlLeft",
  delete: "Delete",
  del: "Delete",
  end: "End",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  home: "Home",
  insert: "Insert",
  meta: "MetaLeft",
  pagedown: "PageDown",
  pageup: "PageUp",
  return: "Enter",
  shift: "ShiftLeft",
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
});

const PUNCTUATION_CODES: Readonly<Record<string, string>> = Object.freeze({
  "/": "Slash",
  "?": "Slash",
  ",": "Comma",
  "<": "Comma",
  ".": "Period",
  ">": "Period",
  ";": "Semicolon",
  ":": "Semicolon",
  "'": "Quote",
  '"': "Quote",
  "[": "BracketLeft",
  "{": "BracketLeft",
  "]": "BracketRight",
  "}": "BracketRight",
  "\\": "Backslash",
  "|": "Backslash",
  "-": "Minus",
  _: "Minus",
  "=": "Equal",
  "+": "Equal",
  "`": "Backquote",
  "~": "Backquote",
});

function makeBinding(
  code: string,
  modifiers: Partial<Omit<ShortcutBinding, "code">> = {},
): ShortcutBinding {
  return Object.freeze({
    code,
    mod: modifiers.mod === true,
    shift: modifiers.shift === true,
    alt: modifiers.alt === true,
  });
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] =
  Object.freeze([
    {
      id: "search",
      label: "Search Frames, Fragments, tags",
      description: "Focus the global search field.",
      scope: "global",
      defaultBinding: makeBinding("KeyK", { mod: true }),
    },
    {
      id: "importFrames",
      label: "Import Frames",
      description: "Open the image import picker.",
      scope: "global",
      defaultBinding: makeBinding("KeyI", { mod: true }),
    },
    {
      id: "quickPreview",
      label: "Quick Preview",
      description: "Hold to preview the focused Frame.",
      scope: "library",
      defaultBinding: makeBinding("Space"),
    },
    {
      id: "closeOverlay",
      label: "Close overlay",
      description: "Close the active preview, menu, or dialog.",
      scope: "overlay",
      defaultBinding: makeBinding("Escape"),
    },
  ] satisfies readonly ShortcutDefinition[]);

export const SHORTCUT_DEFINITION_BY_ID: Readonly<
  Record<ShortcutActionId, ShortcutDefinition>
> = Object.freeze(
  Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition]),
  ) as Record<ShortcutActionId, ShortcutDefinition>,
);

export const DEFAULT_SHORTCUT_BINDINGS: Readonly<
  Record<ShortcutActionId, ShortcutBinding>
> = Object.freeze(
  Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [
      definition.id,
      definition.defaultBinding,
    ]),
  ) as Record<ShortcutActionId, ShortcutBinding>,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCode(rawCode: string | undefined): string | null {
  if (!rawCode) return null;
  if (rawCode === " ") return "Space";

  const trimmed = rawCode.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const alias = CODE_ALIASES[lower];
  if (alias) return alias;

  const punctuation = PUNCTUATION_CODES[trimmed];
  if (punctuation) return punctuation;

  if (/^[a-z]$/i.test(trimmed)) return `Key${trimmed.toUpperCase()}`;
  if (/^[0-9]$/.test(trimmed)) return `Digit${trimmed}`;
  if (/^key[a-z]$/i.test(trimmed)) return `Key${trimmed.at(-1)!.toUpperCase()}`;
  if (/^digit[0-9]$/i.test(trimmed)) return `Digit${trimmed.at(-1)}`;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(trimmed)) return trimmed.toUpperCase();

  if (lower === "dead" || lower === "unidentified") return null;
  return trimmed;
}

export function normalizeShortcutBinding(
  value: unknown,
): ShortcutBinding | null {
  if (!isRecord(value) || typeof value.code !== "string") return null;

  for (const modifier of ["mod", "shift", "alt"] as const) {
    if (modifier in value && typeof value[modifier] !== "boolean") return null;
  }

  const code = normalizeCode(value.code);
  if (!code) return null;

  return makeBinding(code, {
    mod: value.mod === true,
    shift: value.shift === true,
    alt: value.alt === true,
  });
}

export function captureShortcutBinding(
  event: KeyboardEventLike,
): ShortcutBinding | null {
  if (event.repeat || event.isComposing || (event.metaKey && event.ctrlKey)) {
    return null;
  }

  const code = normalizeCode(event.code) ?? normalizeCode(event.key);
  if (!code) return null;

  return makeBinding(code, {
    mod: event.metaKey === true || event.ctrlKey === true,
    shift: event.shiftKey === true,
    alt: event.altKey === true,
  });
}

export function shortcutSignature(binding: ShortcutBinding): string {
  return [
    binding.mod ? "Mod" : "",
    binding.shift ? "Shift" : "",
    binding.alt ? "Alt" : "",
    binding.code,
  ]
    .filter(Boolean)
    .join("+");
}

export function matchesShortcut(
  event: KeyboardEventLike,
  binding: ShortcutBinding,
): boolean {
  const captured = captureShortcutBinding(event);
  if (!captured) return false;

  return (
    captured.code === binding.code &&
    captured.mod === binding.mod &&
    captured.shift === binding.shift &&
    captured.alt === binding.alt
  );
}

function displayKey(code: string, platform: ShortcutPlatform): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);

  const labels: Readonly<Record<string, string>> = {
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    Backquote: "`",
    Backslash: "\\",
    Backspace: platform === "mac" ? "⌫" : "Backspace",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Delete: "Del",
    Enter: "Enter",
    Equal: "=",
    Escape: "Esc",
    Minus: "-",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    Slash: "/",
    Space: "Space",
    Tab: "Tab",
  };
  return labels[code] ?? code;
}

export function formatShortcutBinding(
  binding: ShortcutBinding,
  platform: ShortcutPlatform = "mac",
): string {
  const key = displayKey(binding.code, platform);
  if (platform === "mac") {
    return [
      binding.mod ? "⌘" : "",
      binding.shift ? "⇧" : "",
      binding.alt ? "⌥" : "",
      key,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    binding.mod ? "Ctrl" : "",
    binding.shift ? "Shift" : "",
    binding.alt ? "Alt" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

function isPrintableCode(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    /^Digit[0-9]$/.test(code) ||
    [
      "Backquote",
      "Backslash",
      "BracketLeft",
      "BracketRight",
      "Comma",
      "Equal",
      "Minus",
      "Period",
      "Quote",
      "Semicolon",
      "Slash",
      "Space",
    ].includes(code)
  );
}

export function validateShortcutBinding(
  actionId: ShortcutActionId,
  bindingValue: unknown,
): readonly ShortcutValidationIssue[] {
  const binding = normalizeShortcutBinding(bindingValue);
  if (!binding) {
    return [
      {
        code: "invalid-code",
        message: "Choose a supported key.",
      },
    ];
  }

  const issues: ShortcutValidationIssue[] = [];
  if (MODIFIER_CODES.has(binding.code)) {
    issues.push({
      code: "modifier-only",
      message: "A modifier key cannot be used by itself.",
    });
  }

  const isReserved =
    (binding.mod && MOD_RESERVED_CODES.has(binding.code)) ||
    (binding.alt && binding.code === "Tab") ||
    (binding.mod && binding.alt && binding.code === "Escape");
  if (isReserved) {
    issues.push({
      code: "reserved-os",
      message: "This shortcut is reserved by the operating system.",
    });
  }

  const definition = SHORTCUT_DEFINITION_BY_ID[actionId];
  if (
    definition.scope === "global" &&
    isPrintableCode(binding.code) &&
    !binding.mod &&
    !binding.alt
  ) {
    issues.push({
      code: "global-printable",
      message: "Global shortcuts need Mod or Alt so typing remains available.",
    });
  }

  return issues;
}

export function resolveShortcutBindings(
  overrides: ShortcutBindingMap = {},
): Readonly<Record<ShortcutActionId, ShortcutBinding | null>> {
  return Object.freeze(
    Object.fromEntries(
      SHORTCUT_ACTION_IDS.map((actionId) => {
        if (!(actionId in overrides)) {
          return [actionId, DEFAULT_SHORTCUT_BINDINGS[actionId]];
        }
        const override = overrides[actionId];
        if (override === null) return [actionId, null];
        return [
          actionId,
          normalizeShortcutBinding(override) ??
            DEFAULT_SHORTCUT_BINDINGS[actionId],
        ];
      }),
    ) as Record<ShortcutActionId, ShortcutBinding | null>,
  );
}

export function findShortcutConflicts(
  bindings: ShortcutBindingMap,
): readonly ShortcutConflict[] {
  const grouped = new Map<
    string,
    { binding: ShortcutBinding; actionIds: ShortcutActionId[] }
  >();

  for (const actionId of SHORTCUT_ACTION_IDS) {
    const binding = bindings[actionId];
    if (!binding) continue;

    const normalized = normalizeShortcutBinding(binding);
    if (!normalized) continue;
    const signature = shortcutSignature(normalized);
    const existing = grouped.get(signature);
    if (existing) {
      existing.actionIds.push(actionId);
    } else {
      grouped.set(signature, { binding: normalized, actionIds: [actionId] });
    }
  }

  return [...grouped.entries()]
    .filter(([, value]) => value.actionIds.length > 1)
    .map(([signature, value]) => ({
      signature,
      binding: value.binding,
      actionIds: Object.freeze([...value.actionIds]),
    }));
}
