import type { DragEventHandler, ReactNode } from "react";
import { IconRail, type RailView } from "../components/IconRail";

type AppShellProps = {
  activeView: RailView;
  onViewChange: (view: RailView) => void;
  onTrashDragEnter?: DragEventHandler<HTMLElement>;
  onTrashDragLeave?: DragEventHandler<HTMLElement>;
  onTrashDragOver?: DragEventHandler<HTMLElement>;
  onTrashDrop?: DragEventHandler<HTMLElement>;
  trashDropState?: "idle" | "armed" | "success";
  children: ReactNode;
};

export function AppShell({
  activeView,
  onViewChange,
  onTrashDragEnter,
  onTrashDragLeave,
  onTrashDragOver,
  onTrashDrop,
  trashDropState,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <IconRail
        activeView={activeView}
        trashDropState={trashDropState}
        onTrashDragEnter={onTrashDragEnter}
        onTrashDragLeave={onTrashDragLeave}
        onTrashDragOver={onTrashDragOver}
        onTrashDrop={onTrashDrop}
        onViewChange={onViewChange}
      />
      <main className="app-main">{children}</main>
    </div>
  );
}
