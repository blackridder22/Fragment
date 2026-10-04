import { describe, expect, it } from "vitest";
import {
  createPreviewPrefetcher,
  type PrefetchImage,
} from "./preview-prefetch";

type FakeImage = PrefetchImage & {
  load: () => Promise<void>;
  fail: () => void;
  decodeCalls: number;
};

function fakeImageFactory() {
  const images: FakeImage[] = [];
  const createImage = (): PrefetchImage => {
    const image: FakeImage = {
      src: "",
      onload: null,
      onerror: null,
      decodeCalls: 0,
      decode() {
        image.decodeCalls += 1;
        return Promise.resolve();
      },
      async load() {
        image.onload?.();
        await Promise.resolve();
        await Promise.resolve();
      },
      fail() {
        image.onerror?.();
      },
    };
    images.push(image);
    return image;
  };
  const byUrl = (url: string) => images.find((image) => image.src === url);
  return { createImage, images, byUrl };
}

describe("createPreviewPrefetcher", () => {
  it("tracks the current preview plus neighbours up to the limit", () => {
    const { createImage } = fakeImageFactory();
    const prefetcher = createPreviewPrefetcher({ limit: 3, createImage });

    prefetcher.markCurrent("a");
    prefetcher.prefetch(["b", "c"]);

    expect(prefetcher.urls()).toEqual(["a", "b", "c"]);
    expect(prefetcher.size).toBe(3);
  });

  it("evicts the least recently used preview but never the current one", () => {
    const { createImage, byUrl } = fakeImageFactory();
    const prefetcher = createPreviewPrefetcher({ limit: 3, createImage });

    prefetcher.markCurrent("a");
    prefetcher.prefetch(["b", "c"]);
    prefetcher.markCurrent("c");
    prefetcher.prefetch(["d", "b"]);

    expect(prefetcher.urls()).toEqual(["c", "d", "b"]);
    expect(prefetcher.has("a")).toBe(false);
    expect(byUrl("a")).toBeUndefined();
  });

  it("keeps the current preview even when it is the oldest entry", () => {
    const { createImage } = fakeImageFactory();
    const prefetcher = createPreviewPrefetcher({ limit: 2, createImage });

    prefetcher.markCurrent("a");
    prefetcher.prefetch(["b", "c", "d"]);

    expect(prefetcher.has("a")).toBe(true);
    expect(prefetcher.size).toBe(2);
    expect(prefetcher.urls()).toEqual(["a", "d"]);
  });

  it("reports ready only after load and decode complete", async () => {
    const { createImage, byUrl } = fakeImageFactory();
    const prefetcher = createPreviewPrefetcher({ createImage });

    prefetcher.prefetch(["a"]);
    expect(prefetcher.isReady("a")).toBe(false);

    const image = byUrl("a")!;
    expect(image.decoding).toBe("async");
    await image.load();

    expect(image.decodeCalls).toBe(1);
    expect(prefetcher.isReady("a")).toBe(true);
    await expect(prefetcher.whenSettled("a")).resolves.toBe("ready");
  });

  it("marks failed loads and ignores unknown urls", async () => {
    const { createImage, byUrl } = fakeImageFactory();
    const prefetcher = createPreviewPrefetcher({ createImage });

    prefetcher.prefetch(["broken", ""]);
    byUrl("broken")!.fail();

    expect(prefetcher.isReady("broken")).toBe(false);
    await expect(prefetcher.whenSettled("broken")).resolves.toBe("failed");
    await expect(prefetcher.whenSettled("missing")).resolves.toBeNull();
    expect(prefetcher.size).toBe(1);
  });

  it("does not create a second request for a url that is already tracked", () => {
    const { createImage, images } = fakeImageFactory();
    const prefetcher = createPreviewPrefetcher({ createImage });

    prefetcher.prefetch(["a"]);
    prefetcher.prefetch(["a"]);
    prefetcher.markCurrent("a");

    expect(images).toHaveLength(1);
  });

  it("releases every image on cancel and settles pending loads as failed", async () => {
    const { createImage, byUrl } = fakeImageFactory();
    const prefetcher = createPreviewPrefetcher({ createImage });

    prefetcher.markCurrent("a");
    prefetcher.prefetch(["b"]);
    const pending = prefetcher.whenSettled("b");
    const imageA = byUrl("a")!;
    const imageB = byUrl("b")!;

    prefetcher.cancel();

    expect(prefetcher.size).toBe(0);
    expect(imageA.src).toBe("");
    expect(imageB.src).toBe("");
    expect(imageA.onload).toBeNull();
    await expect(pending).resolves.toBe("failed");
  });

  it("ignores prefetch requests after dispose", () => {
    const { createImage, images } = fakeImageFactory();
    const prefetcher = createPreviewPrefetcher({ createImage });

    prefetcher.dispose();
    prefetcher.prefetch(["a"]);
    prefetcher.markCurrent("b");

    expect(images).toHaveLength(0);
    expect(prefetcher.size).toBe(0);
  });
});
