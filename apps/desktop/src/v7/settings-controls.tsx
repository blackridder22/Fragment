import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  ChevronDown,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_DEFINITIONS,
  captureShortcutBinding,
  findShortcutConflicts,
  formatShortcutBinding,
  shortcutSignature,
  validateShortcutBinding,
  type ShortcutActionId,
  type ShortcutBinding,
} from "../features/shortcuts/shortcut-model";
import type {
  DeletePolicy,
  NativeHostStatus,
  ThemePreference,
} from "../store/library-types";
import type { V7SettingsState } from "./settings-state";

export function SettingsHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <header className="v7-settings-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

export function PreferenceGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section className="v7-settings-group">
      <header>{label}</header>
      {children}
    </section>
  );
}

export function PreferenceRow({
  compact = false,
  control,
  description,
  label,
  last = false,
}: {
  compact?: boolean;
  control: ReactNode;
  description: string;
  label: string;
  last?: boolean;
}) {
  return (
    <div className="v7-settings-row" data-compact={compact} data-last={last}>
      <div className="v7-settings-row-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <div className="v7-settings-control-lane">{control}</div>
    </div>
  );
}

export function NativeHostStatusControl({
  status,
  onRefresh,
}: {
  status: NativeHostStatus;
  onRefresh?: () => void | Promise<void>;
}) {
  const icon =
    status.state === "ready" ? (
      <CheckCircle2 aria-hidden="true" size={14} />
    ) : status.state === "checking" ? (
      <LoaderCircle
        aria-hidden="true"
        className="v7-settings-status-spinner"
        size={14}
      />
    ) : (
      <CircleAlert aria-hidden="true" size={14} />
    );
  const content = (
    <>
      {icon}
      <span>{status.label}</span>
    </>
  );

  return onRefresh ? (
    <button
      aria-label="Check native capture host"
      className="v7-settings-status"
      data-state={status.state}
      disabled={status.state === "checking"}
      onClick={() => void onRefresh()}
      type="button"
    >
      {content}
    </button>
  ) : (
    <span className="v7-settings-status" data-state={status.state}>
      {content}
    </span>
  );
}

export function ShortcutRow({
  actionId,
  binding,
  bindings,
  description,
  label,
  last = false,
  onChange,
}: {
  actionId: ShortcutActionId;
  binding: ShortcutBinding;
  bindings: V7SettingsState["shortcuts"];
  description: string;
  label: string;
  last?: boolean;
  onChange: (binding: ShortcutBinding) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDefault =
    shortcutSignature(binding) ===
    shortcutSignature(DEFAULT_SHORTCUT_BINDINGS[actionId]);

  return (
    <PreferenceRow
      compact
      control={
        <div className="v7-settings-shortcut-editor">
          {error ? (
            <span className="v7-settings-shortcut-error" title={error}>
              {error}
            </span>
          ) : null}
          <button
            aria-label={`Record shortcut for ${label}`}
            className="v7-settings-shortcut-control"
            data-conflict={Boolean(error)}
            data-recording={recording}
            onBlur={() => setRecording(false)}
            onClick={() => {
              setError(null);
              setRecording(true);
            }}
            onKeyDown={(event) => {
              if (!recording) return;
              event.preventDefault();
              event.stopPropagation();
              const captured = captureShortcutBinding(event);
              if (!captured) return;
              const issue = validateShortcutBinding(actionId, captured)[0];
              if (issue) {
                setError(issue.message);
                return;
              }
              const conflict = findShortcutConflicts({
                ...bindings,
                [actionId]: captured,
              }).find((item) => item.actionIds.includes(actionId));
              if (conflict) {
                const otherAction = conflict.actionIds.find(
                  (id) => id !== actionId,
                );
                const otherLabel = SHORTCUT_DEFINITIONS.find(
                  (item) => item.id === otherAction,
                )?.label;
                setError(`Already used by ${otherLabel ?? "another action"}.`);
                return;
              }
              onChange(captured);
              setError(null);
              setRecording(false);
            }}
            type="button"
          >
            <kbd>
              {recording ? "Press shortcut" : formatShortcutBinding(binding)}
            </kbd>
          </button>
          <button
            aria-label={`Reset ${label} shortcut`}
            className="v7-settings-shortcut-reset"
            disabled={isDefault}
            onClick={() => {
              setError(null);
              setRecording(false);
              onChange(DEFAULT_SHORTCUT_BINDINGS[actionId]);
            }}
            title={isDefault ? "Using default shortcut" : "Restore default"}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
          </button>
        </div>
      }
      description={description}
      label={label}
      last={last}
    />
  );
}

export function SwitchControl({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="v7-settings-switch"
      data-checked={checked}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

export function ThemeControl({
  onChange,
  value,
}: {
  onChange: (theme: ThemePreference) => void;
  value: ThemePreference;
}) {
  const options: Array<{
    icon: ReactNode;
    label: string;
    value: ThemePreference;
  }> = [
    {
      icon: <Monitor aria-hidden="true" size={13} />,
      label: "System",
      value: "system",
    },
    {
      icon: <Sun aria-hidden="true" size={13} />,
      label: "Light",
      value: "light",
    },
    {
      icon: <Moon aria-hidden="true" size={13} />,
      label: "Dark",
      value: "dark",
    },
  ];

  return (
    <div
      aria-label="Window theme"
      className="v7-settings-theme-control"
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          data-active={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SelectControl<T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <label className="v7-settings-select">
      <span className="v7-settings-visually-hidden">{ariaLabel}</span>
      <select
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" size={14} strokeWidth={1.7} />
    </label>
  );
}

export function deletePolicyDescription(policy: DeletePolicy) {
  return policy === "forever"
    ? "Items are permanently removed immediately."
    : `Items remain recoverable in Trash for ${policy} days.`;
}
