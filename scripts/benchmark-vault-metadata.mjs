import { performance } from "node:perf_hooks";
import {
  createVaultFixture,
  FIXTURE_SIZES,
  serializeVaultFixture,
} from "./vault-fixture-lib.mjs";

const SAMPLE_COUNT = 12;
const WARMUP_COUNT = 3;

function percentile(samples, quantile) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * quantile) - 1,
  );
  return sorted[index];
}

function measure(operation) {
  const startedAt = performance.now();
  operation();
  return performance.now() - startedAt;
}

function benchmark(operation) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    operation();
  }
  const samples = Array.from({ length: SAMPLE_COUNT }, () =>
    measure(operation),
  );
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
  };
}

const results = [];
for (const size of FIXTURE_SIZES) {
  const fixture = createVaultFixture(size);
  const serialized = serializeVaultFixture(fixture);

  results.push({
    size,
    parse: benchmark(() => JSON.parse(serialized)),
    firstPage: benchmark(() => {
      fixture.fragments
        .filter((fragment) => fragment.deletedAt === null)
        .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
        .slice(0, 60);
    }),
    membershipIndex: benchmark(() => {
      const byFrame = new Map();
      for (const fragment of fixture.fragments) {
        const memberships = byFrame.get(fragment.frameId) ?? [];
        memberships.push(fragment.id);
        byFrame.set(fragment.frameId, memberships);
      }
    }),
    selectAllIds: benchmark(() => {
      new Set(
        fixture.fragments
          .filter((fragment) => fragment.deletedAt === null)
          .map((fragment) => fragment.id),
      );
    }),
  });
}

console.log("Synthetic Vault metadata benchmark (milliseconds)");
console.table(
  results.map((result) => ({
    fragments: result.size,
    "parse p50": result.parse.medianMs.toFixed(2),
    "parse p95": result.parse.p95Ms.toFixed(2),
    "page p50": result.firstPage.medianMs.toFixed(2),
    "page p95": result.firstPage.p95Ms.toFixed(2),
    "index p95": result.membershipIndex.p95Ms.toFixed(2),
    "select p95": result.selectAllIds.p95Ms.toFixed(2),
  })),
);
