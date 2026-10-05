import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  daysUntil,
  deletionLabel,
  estimateDeleteAfter,
  retentionFromDeletePolicy,
  retentionSummary,
} from "./retention";

const now = new Date("2026-10-04T12:00:00.000Z");

describe("retention label", () => {
  it("reports the days left from the row's deleteAfter", () => {
    const inSixDays = new Date(now.getTime() + 6 * DAY_MS).toISOString();
    const inOneDay = new Date(now.getTime() + DAY_MS).toISOString();
    const inHalfADay = new Date(now.getTime() + DAY_MS / 2).toISOString();

    expect(deletionLabel(inSixDays, now)).toBe("Deletes in 6 days");
    expect(deletionLabel(inOneDay, now)).toBe("Deletes in 1 day");
    expect(deletionLabel(inHalfADay, now)).toBe("Deletes in 1 day");
    expect(daysUntil(inSixDays, now)).toBe(6);
  });

  it("says today once the date has passed", () => {
    const yesterday = new Date(now.getTime() - DAY_MS).toISOString();
    expect(deletionLabel(yesterday, now)).toBe("Deletes today");
    expect(deletionLabel(now.toISOString(), now)).toBe("Deletes today");
  });

  it("keeps rows without a date until the Trash is emptied", () => {
    expect(deletionLabel(null, now)).toBe("Deleted forever on empty");
    expect(deletionLabel(undefined, now)).toBe("Deleted forever on empty");
    expect(deletionLabel("not a date", now)).toBe("Deleted forever on empty");
  });
});

describe("retention policy", () => {
  it("parses the Settings delete policy", () => {
    expect(retentionFromDeletePolicy("31")).toEqual({ kind: "days", days: 31 });
    expect(retentionFromDeletePolicy("7")).toEqual({ kind: "days", days: 7 });
    expect(retentionFromDeletePolicy("forever")).toEqual({ kind: "forever" });
    expect(retentionFromDeletePolicy("0")).toEqual({ kind: "forever" });
    expect(retentionFromDeletePolicy(undefined)).toEqual({ kind: "forever" });
  });

  it("mirrors the Settings description", () => {
    expect(retentionSummary({ kind: "days", days: 14 })).toBe(
      "Items remain recoverable in Trash for 14 days",
    );
    expect(retentionSummary({ kind: "forever" })).toBe(
      "Items are permanently removed immediately",
    );
  });

  it("estimates a Frame's deleteAfter from its deletion time and the policy", () => {
    const deletedAt = "2026-10-01T00:00:00.000Z";
    expect(estimateDeleteAfter(deletedAt, { kind: "days", days: 7 })).toBe(
      "2026-10-08T00:00:00.000Z",
    );
    expect(estimateDeleteAfter(deletedAt, { kind: "forever" })).toBeNull();
    expect(estimateDeleteAfter("bad", { kind: "days", days: 7 })).toBeNull();
  });
});
