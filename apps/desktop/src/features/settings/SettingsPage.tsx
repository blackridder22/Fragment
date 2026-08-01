import { Info, Monitor, Moon, Plug, Sun, Trash2 } from "lucide-react";

export type ThemePreference = "light" | "dark" | "system";
export type DeletePolicy = "forever" | "7" | "14" | "24" | "31";

type SettingsPageProps = {
  deletePolicy: DeletePolicy;
  theme: ThemePreference;
  onDeletePolicyChange: (policy: DeletePolicy) => void;
  onThemeChange: (theme: ThemePreference) => void;
};

const DELETE_POLICIES: DeletePolicy[] = ["forever", "7", "14", "24", "31"];

export function SettingsPage({
  deletePolicy,
  theme,
  onDeletePolicyChange,
  onThemeChange,
}: SettingsPageProps) {
  return (
    <section className="utility-panel utility-panel-wide settings-page">
      <h1>Settings</h1>
      <div className="settings-grid">
        <article>
          <Plug size={19} />
          <span>Capture connection</span>
          <strong>Native host bundled</strong>
        </article>
        <article>
          <Info size={19} />
          <span>About</span>
          <strong>Fragment 0.0.4</strong>
        </article>
        <article className="settings-theme-card">
          <Trash2 size={19} />
          <span>Delete behavior</span>
          <strong>
            {deletePolicy === "forever"
              ? "Delete forever"
              : `Trash for ${deletePolicy} days`}
          </strong>
          <div
            className="theme-toggle"
            aria-label="Delete behavior"
            role="group"
          >
            {DELETE_POLICIES.map((policy) => (
              <button
                aria-pressed={deletePolicy === policy}
                className="theme-option"
                data-active={deletePolicy === policy}
                key={policy}
                onClick={() => onDeletePolicyChange(policy)}
                type="button"
              >
                {policy === "forever" ? "Forever" : `${policy}d`}
              </button>
            ))}
          </div>
        </article>
        <article className="settings-theme-card">
          <Sun size={19} />
          <span>Appearance</span>
          <strong>Window theme</strong>
          <div className="theme-toggle" aria-label="Appearance" role="group">
            <button
              aria-pressed={theme === "system"}
              className="theme-option"
              data-active={theme === "system"}
              onClick={() => onThemeChange("system")}
              type="button"
            >
              <Monitor aria-hidden="true" size={15} />
              System
            </button>
            <button
              aria-pressed={theme === "light"}
              className="theme-option"
              data-active={theme === "light"}
              onClick={() => onThemeChange("light")}
              type="button"
            >
              <Sun aria-hidden="true" size={15} />
              Light
            </button>
            <button
              aria-pressed={theme === "dark"}
              className="theme-option"
              data-active={theme === "dark"}
              onClick={() => onThemeChange("dark")}
              type="button"
            >
              <Moon aria-hidden="true" size={15} />
              Dark
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
