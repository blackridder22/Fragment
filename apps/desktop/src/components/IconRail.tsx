import {
  Aperture,
  Images,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Trash2,
} from "lucide-react";

export type RailView = "home" | "frames" | "trash" | "settings";

type IconRailProps = {
  activeView: RailView;
  collapsed?: boolean;
  dropTarget?: string | null;
  onNavigatorToggle?: () => void;
  onViewChange: (view: RailView) => void;
  trashDropState?: "idle" | "armed" | "success";
};

const items: Array<{
  id: RailView;
  label: string;
  icon: typeof Aperture;
}> = [
  { id: "home", label: "Vault", icon: Aperture },
  { id: "frames", label: "Frames", icon: Images },
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "settings", label: "Settings", icon: Settings },
];

export function IconRail({
  activeView,
  collapsed = true,
  dropTarget = null,
  onNavigatorToggle,
  onViewChange,
  trashDropState = "idle",
}: IconRailProps) {
  return (
    <nav className="icon-rail" aria-label="Primary">
      <div className="sidebar-brand">
        <img
          className="rail-mark"
          src="/Fragment.png"
          alt=""
          aria-hidden="true"
        />
        <div>
          <strong>Fragment</strong>
          <span>Auto Scale Agency</span>
        </div>
      </div>
      <div className="rail-items">
        {items.map((item) => {
          const Icon = item.icon;
          const isTrash = item.id === "trash";
          if (isTrash) {
            return (
              <div
                className="rail-drop-zone"
                data-drop-state={trashDropState}
                data-drop-target="trash"
                data-trash-zone="true"
                key={item.id}
              >
                <button
                  aria-current={activeView === item.id ? "page" : undefined}
                  aria-label={item.label}
                  className="rail-button"
                  data-active={activeView === item.id}
                  data-trash-target="true"
                  data-drop-state={trashDropState}
                  onClick={() => onViewChange(item.id)}
                  title={item.label}
                  type="button"
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={1.9} />
                  <span>{item.label}</span>
                </button>
              </div>
            );
          }
          const isVault = item.id === "home";
          return (
            <button
              aria-current={activeView === item.id ? "page" : undefined}
              aria-label={item.label}
              className="rail-button"
              data-active={activeView === item.id}
              data-drop-state={
                isVault && dropTarget === "frame-root" ? "armed" : undefined
              }
              data-drop-target={isVault ? "frame-root" : undefined}
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={item.label}
              type="button"
            >
              <Icon aria-hidden="true" size={20} strokeWidth={1.9} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-footer">
        {onNavigatorToggle ? (
          <button
            aria-label={
              collapsed ? "Open Frame tree" : "Close Frame tree"
            }
            className="rail-button rail-navigator-toggle"
            data-no-frame-drag="true"
            onClick={onNavigatorToggle}
            title={collapsed ? "Open Frame tree" : "Close Frame tree"}
            type="button"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" size={19} strokeWidth={1.9} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={19} strokeWidth={1.9} />
            )}
            <span>{collapsed ? "Open Frame tree" : "Close Frame tree"}</span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}
