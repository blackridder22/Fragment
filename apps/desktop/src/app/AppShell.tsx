import type { CSSProperties, ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  navigator: ReactNode;
  navigatorCollapsed: boolean;
  navigatorWidth: number;
};

export function AppShell({
  children,
  navigator,
  navigatorCollapsed,
  navigatorWidth,
}: AppShellProps) {
  return (
    <div
      className="app-shell"
      data-navigator-collapsed={navigatorCollapsed}
      style={
        {
          "--frame-tree-width": `${navigatorWidth}px`,
          "--app-sidebar-width": `${navigatorCollapsed ? 78 : navigatorWidth + 78}px`,
        } as CSSProperties
      }
    >
      {navigator}
      <main className="app-main">{children}</main>
    </div>
  );
}
