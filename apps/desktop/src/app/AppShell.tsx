import type { CSSProperties, ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  navigator: ReactNode;
  navigatorCollapsed: boolean;
  navigatorWidth: number;
  windowBar: ReactNode;
};

export function AppShell({
  children,
  navigator,
  navigatorCollapsed,
  navigatorWidth,
  windowBar,
}: AppShellProps) {
  return (
    <div
      className="app-shell"
      data-navigator-collapsed={navigatorCollapsed}
      style={
        {
          "--frame-tree-width": `${navigatorWidth}px`,
          "--app-sidebar-width": `${navigatorCollapsed ? 64 : navigatorWidth}px`,
        } as CSSProperties
      }
    >
      {windowBar}
      <div className="app-body">
        {navigator}
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
