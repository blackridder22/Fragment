import { useEffect } from "react";
import { OverlayLayer } from "./app/OverlayLayer";
import {
  FramesPageContainer,
  SettingsPageContainer,
  TrashPageContainer,
  VaultPageContainer,
} from "./app/pages";
import { ShellContainer } from "./app/ShellContainer";
import { useGlobalShortcuts } from "./app/useGlobalShortcuts";
import { startLibrary } from "./store/library-bootstrap";
import { selectShowsHomeDashboard } from "./store/library-selectors";
import { useLibraryStore } from "./store/library-store";

/**
 * Composition root. State lives in `store/`; pages and overlays subscribe
 * to it through selectors, so this component only picks the page to show.
 */
export default function App() {
  useEffect(() => startLibrary(), []);
  useGlobalShortcuts();
  const view = useLibraryStore((state) => state.view);
  const showDashboard = useLibraryStore(selectShowsHomeDashboard);

  const page =
    view === "settings" ? (
      <SettingsPageContainer />
    ) : view === "trash" ? (
      <TrashPageContainer />
    ) : showDashboard ? (
      <VaultPageContainer />
    ) : (
      <FramesPageContainer />
    );

  return (
    <ShellContainer>
      {page}
      <OverlayLayer />
    </ShellContainer>
  );
}
