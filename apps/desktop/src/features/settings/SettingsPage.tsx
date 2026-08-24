import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Info,
  Library,
  Monitor,
  Moon,
  Palette,
  Plug,
  ShieldCheck,
  Sun,
  Trash2,
} from "lucide-react";

export type ThemePreference = "light" | "dark" | "system";
export type DeletePolicy = "forever" | "7" | "14" | "24" | "31";

type SettingsPageProps = {
  deletePolicy: DeletePolicy;
  theme: ThemePreference;
  onDeletePolicyChange: (policy: DeletePolicy) => void;
  onThemeChange: (theme: ThemePreference) => void;
};

type SettingsSection = "appearance" | "library" | "capture" | "about";

const DELETE_POLICIES: DeletePolicy[] = ["forever", "7", "14", "24", "31"];

export function SettingsPage({
  deletePolicy,
  theme,
  onDeletePolicyChange,
  onThemeChange,
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>("appearance");

  return (
    <section className="settings-page">
      <nav className="settings-section-nav" aria-label="Settings sections">
        <SettingsNavButton
          active={section === "appearance"}
          icon={<Palette aria-hidden="true" size={16} />}
          label="Appearance"
          onClick={() => setSection("appearance")}
        />
        <SettingsNavButton
          active={section === "library"}
          icon={<Library aria-hidden="true" size={16} />}
          label="Library"
          onClick={() => setSection("library")}
        />
        <SettingsNavButton
          active={section === "capture"}
          icon={<Plug aria-hidden="true" size={16} />}
          label="Capture"
          onClick={() => setSection("capture")}
        />
        <SettingsNavButton
          active={section === "about"}
          icon={<Info aria-hidden="true" size={16} />}
          label="About"
          onClick={() => setSection("about")}
        />
      </nav>

      <div className="settings-main" data-settings-section={section}>
        {section === "appearance" ? (
          <>
            <SettingsHeading
              eyebrow="Interface"
              title="Appearance"
              description="Choose how Fragment looks on this Mac. Spacing and layout stay consistent in every mode."
            />
            <div className="settings-group">
              <div className="settings-row settings-row-stacked">
                <div className="settings-row-copy">
                  <span className="settings-row-icon">
                    <Sun aria-hidden="true" size={16} />
                  </span>
                  <span>
                    <strong>Window theme</strong>
                    <small>Follow macOS or keep a fixed appearance.</small>
                  </span>
                </div>
                <div
                  className="settings-segmented-control"
                  aria-label="Window theme"
                  role="group"
                >
                  <ThemeButton
                    active={theme === "system"}
                    icon={<Monitor aria-hidden="true" size={14} />}
                    label="System"
                    onClick={() => onThemeChange("system")}
                  />
                  <ThemeButton
                    active={theme === "light"}
                    icon={<Sun aria-hidden="true" size={14} />}
                    label="Light"
                    onClick={() => onThemeChange("light")}
                  />
                  <ThemeButton
                    active={theme === "dark"}
                    icon={<Moon aria-hidden="true" size={14} />}
                    label="Dark"
                    onClick={() => onThemeChange("dark")}
                  />
                </div>
              </div>
            </div>
          </>
        ) : null}

        {section === "library" ? (
          <>
            <SettingsHeading
              eyebrow="Local vault"
              title="Library"
              description="Control how deleted Frames and Fragments are retained on this Mac."
            />
            <div className="settings-group">
              <div className="settings-row settings-row-stacked">
                <div className="settings-row-copy">
                  <span className="settings-row-icon danger">
                    <Trash2 aria-hidden="true" size={16} />
                  </span>
                  <span>
                    <strong>Delete behavior</strong>
                    <small>
                      {deletePolicy === "forever"
                        ? "Items are removed immediately."
                        : `Items remain recoverable for ${deletePolicy} days.`}
                    </small>
                  </span>
                </div>
                <div
                  className="settings-segmented-control delete-policy-control"
                  aria-label="Delete behavior"
                  role="group"
                >
                  {DELETE_POLICIES.map((policy) => (
                    <button
                      aria-pressed={deletePolicy === policy}
                      data-active={deletePolicy === policy}
                      key={policy}
                      onClick={() => onDeletePolicyChange(policy)}
                      type="button"
                    >
                      {policy === "forever" ? "Immediately" : `${policy} days`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : null}

        {section === "capture" ? (
          <>
            <SettingsHeading
              eyebrow="Browser bridge"
              title="Capture"
              description="Fragment saves only the Frames you explicitly choose."
            />
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-icon success">
                    <Plug aria-hidden="true" size={16} />
                  </span>
                  <span>
                    <strong>Native capture host</strong>
                    <small>Bundled with Fragment Desktop.</small>
                  </span>
                </div>
                <span className="settings-status success">
                  <CheckCircle2 aria-hidden="true" size={14} />
                  Ready
                </span>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-icon">
                    <ShieldCheck aria-hidden="true" size={16} />
                  </span>
                  <span>
                    <strong>Local-first storage</strong>
                    <small>Originals and metadata stay on this Mac.</small>
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {section === "about" ? (
          <>
            <SettingsHeading
              eyebrow="Auto Scale Agency"
              title="About Fragment"
              description="A visual reference vault built for fast capture, calm organization, and focused review."
            />
            <div className="settings-about-card">
              <img alt="Fragment" src="/Fragment.png" />
              <span>
                <strong>Fragment Desktop</strong>
                <small>vbeta 0.0.7 candidate</small>
              </span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function SettingsNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      data-active={active}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SettingsHeading({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="settings-heading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function ThemeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      data-active={active}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
