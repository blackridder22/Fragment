import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { FragmentPalette } from "@fragment/shared";
import {
  getFragmentPalette,
  isTauriRuntime,
  retryFragmentPalette,
} from "../../lib/tauri";

export function useFragmentPalette(id: string | null) {
  const [value, setValue] = useState<{
    id: string;
    palette: FragmentPalette;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setError(null);
    if (!id || !isTauriRuntime()) return;
    let disposed = false;
    let assetId: string | undefined;
    const refresh = async () => {
      try {
        const palette = await getFragmentPalette(id);
        assetId = palette.assetId;
        if (!disposed) setValue({ id, palette });
      } catch (cause) {
        if (!disposed) setError(String(cause));
      }
    };
    void refresh();
    const subscription = listen<string[]>("palette-changed", ({ payload }) => {
      if (!assetId || payload.includes(assetId)) void refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
      void subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [id, retry]);
  const retryPalette = useCallback(async () => {
    if (!id) return;
    try {
      await retryFragmentPalette(id);
      setRetry((r) => r + 1);
    } catch (cause) {
      setError(String(cause));
    }
  }, [id]);
  return {
    palette: value?.id === id ? value.palette : null,
    error,
    retryPalette,
  };
}
