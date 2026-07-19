import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { packageExtensionManifest } from "./src/build/manifest";

const canonicalManifest = JSON.parse(
  readFileSync(resolve(__dirname, "manifest.json"), "utf8"),
) as unknown;
const packageMetadata = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { version: string };
const packagedManifest = packageExtensionManifest(
  canonicalManifest,
  packageMetadata.version,
);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "fragment-extension-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "manifest.json",
          source: packagedManifest,
        });
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        "content/capture-mode": resolve(__dirname, "src/content/capture-mode.ts"),
        "popup/index": resolve(__dirname, "src/popup/index.html")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
