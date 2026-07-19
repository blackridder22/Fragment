import { createHash } from "node:crypto";

export const FIXTURE_SIZES = Object.freeze([60, 1_000, 10_000]);
export const FIXTURE_SEED = "fragment-v0.0.3-synthetic-vault";
export const FIXTURE_SCHEMA_VERSION = 1;

const EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");
const FRAME_COUNTS = new Map([
  [60, 6],
  [1_000, 12],
  [10_000, 24],
]);
const WIDTHS = [320, 480, 640, 800, 1_024, 1_440, 1_920];
const ASPECT_RATIOS = [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16, 3 / 2, 2 / 3];
const MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

function padded(value, width = 6) {
  return String(value).padStart(width, "0");
}

function fixtureId(kind, index) {
  return `${kind}-${padded(index + 1)}`;
}

function isoAt(offsetSeconds) {
  return new Date(EPOCH_MS + offsetSeconds * 1_000).toISOString();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extensionForMime(mimeType) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

export function createVaultFixture(size) {
  if (!FIXTURE_SIZES.includes(size)) {
    throw new Error(`Unsupported fixture size: ${size}`);
  }

  const frameCount = FRAME_COUNTS.get(size);
  const assetCount = Math.ceil(size * 0.82);
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const createdAt = isoAt(index);
    return {
      id: fixtureId("frame", index),
      parentId: null,
      name: index === 0 ? "Inbox" : `Synthetic Frame ${padded(index, 2)}`,
      description: "Generated benchmark metadata. Contains no user data.",
      icon: index === 0 ? "inbox" : "image",
      sortOrder: index,
      isSystem: index === 0,
      createdAt,
      updatedAt: createdAt,
    };
  });

  const assets = Array.from({ length: assetCount }, (_, index) => {
    const mimeType = MIME_TYPES[index % MIME_TYPES.length];
    const extension = extensionForMime(mimeType);
    const width = WIDTHS[index % WIDTHS.length];
    const ratio = ASPECT_RATIOS[index % ASPECT_RATIOS.length];
    const height = Math.max(1, Math.round(width / ratio));
    const id = fixtureId("asset", index);
    const createdAt = isoAt(index + 100);

    return {
      id,
      originalPath: `originals/2026/01/${id}.${extension}`,
      thumbnailPath: `thumbnails/${id}.png`,
      previewPath: `previews/${id}.png`,
      mimeType,
      width,
      height,
      fileSize: width * height * (index % 5 === 0 ? 2 : 1),
      sha256: sha256(`${FIXTURE_SEED}:asset:${index}`),
      perceptualHash: null,
      sourceUrl: `https://assets.fragment.invalid/${id}.${extension}`,
      pageUrl: `https://pages.fragment.invalid/reference/${id}`,
      siteName: "Fragment Synthetic Fixture",
      capturedFrom: "synthetic_fixture",
      createdAt,
      updatedAt: createdAt,
    };
  });

  const fragments = Array.from({ length: size }, (_, index) => {
    const membershipOrdinal = index < assetCount ? 0 : 1;
    const assetIndex = membershipOrdinal === 0 ? index : index - assetCount;
    const asset = assets[assetIndex];
    const frameIndex = (assetIndex * 7 + membershipOrdinal * 5) % frameCount;
    const capturedAt = isoAt(index + 1_000);
    const isTrashed = index % 17 === 0;
    const deletedAt = isTrashed ? isoAt(index + 20_000) : null;
    const deleteAfter = isTrashed
      ? new Date(
          Date.parse(deletedAt) + 31 * 24 * 60 * 60 * 1_000,
        ).toISOString()
      : null;

    return {
      id: fixtureId("fragment", index),
      assetId: asset.id,
      frameId: frames[frameIndex].id,
      title: `Synthetic Fragment ${padded(index + 1)}`,
      description: null,
      note: index % 9 === 0 ? "Deterministic benchmark note" : null,
      sourceUrl: asset.sourceUrl,
      pageUrl: asset.pageUrl,
      siteName: asset.siteName,
      creatorName: null,
      capturedAt,
      createdAt: capturedAt,
      updatedAt: deletedAt ?? capturedAt,
      deletedAt,
      deleteAfter,
      tags: index % 5 === 0 ? ["synthetic", `group-${index % 10}`] : [],
    };
  });

  const activeCount = fragments.reduce(
    (count, fragment) => count + (fragment.deletedAt === null ? 1 : 0),
    0,
  );

  const fixture = {
    fixture: true,
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    seed: FIXTURE_SEED,
    generatedAt: new Date(EPOCH_MS).toISOString(),
    size,
    counts: {
      frames: frames.length,
      assets: assets.length,
      fragments: fragments.length,
      activeFragments: activeCount,
      trashedFragments: fragments.length - activeCount,
    },
    frames,
    assets,
    fragments,
  };

  validateVaultFixture(fixture);
  return fixture;
}

export function serializeVaultFixture(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

export function fixtureDigest(serializedFixture) {
  return sha256(serializedFixture);
}

export function validateVaultFixture(fixture) {
  if (fixture.fixture !== true || fixture.seed !== FIXTURE_SEED) {
    throw new Error("Fixture marker or seed is invalid");
  }
  if (fixture.fragments.length !== fixture.size) {
    throw new Error("Fragment count does not match fixture size");
  }

  const frameIds = new Set(fixture.frames.map((frame) => frame.id));
  const assetIds = new Set();
  const assetHashes = new Set();
  for (const asset of fixture.assets) {
    if (assetIds.has(asset.id) || assetHashes.has(asset.sha256)) {
      throw new Error(`Duplicate synthetic asset: ${asset.id}`);
    }
    if (
      asset.originalPath.startsWith("/") ||
      asset.thumbnailPath.startsWith("/") ||
      asset.previewPath.startsWith("/")
    ) {
      throw new Error(`Fixture contains an absolute asset path: ${asset.id}`);
    }
    if (
      !asset.sourceUrl.includes(".invalid/") ||
      !asset.pageUrl.includes(".invalid/")
    ) {
      throw new Error(`Fixture contains a non-reserved URL: ${asset.id}`);
    }
    assetIds.add(asset.id);
    assetHashes.add(asset.sha256);
  }

  const memberships = new Set();
  for (const fragment of fixture.fragments) {
    if (!frameIds.has(fragment.frameId) || !assetIds.has(fragment.assetId)) {
      throw new Error(`Fixture contains a broken membership: ${fragment.id}`);
    }
    const membershipKey = `${fragment.frameId}:${fragment.assetId}`;
    if (memberships.has(membershipKey)) {
      throw new Error(
        `Fixture contains a duplicate membership: ${membershipKey}`,
      );
    }
    memberships.add(membershipKey);
  }
}
