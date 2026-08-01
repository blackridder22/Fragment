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
          "--frame-navigator-width": `${navigatorCollapsed ? 68 : navigatorWidth}px`,
        } as CSSProperties
      }
    >
      {navigator}
      <main className="app-main">{children}</main>
    </div>
  );
}
