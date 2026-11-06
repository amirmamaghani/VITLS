import { describe, expect, it } from "vitest";

import { formatMinutes, formatSyncAge, isStale } from "./today";

describe("today helpers", () => {
  it("formats sleep minutes", () => {
    expect(formatMinutes(452)).toBe("7 h 32 min");
    expect(formatMinutes(45)).toBe("45 min");
  });
  it("formats sync age", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(formatSyncAge(null, now)).toBe("no data yet");
    expect(formatSyncAge("2026-10-10T11:55:00Z", now)).toBe("5 min ago");
    expect(formatSyncAge("2026-10-10T09:00:00Z", now)).toBe("3 h ago");
    expect(formatSyncAge("2026-10-08T09:00:00Z", now)).toBe("2 days ago");
  });
});

describe("isStale", () => {
  const now = new Date("2026-10-11T08:00:00Z");
  it("is stale without a sync", () => expect(isStale(undefined, now)).toBe(true));
  it("is fresh within ten minutes", () => expect(isStale("2026-10-11T07:55:00Z", now)).toBe(false));
  it("is stale at ten minutes and beyond", () => {
    expect(isStale("2026-10-11T07:50:00Z", now)).toBe(true);
    expect(isStale("2026-10-10T19:18:00Z", now)).toBe(true);
  });
});
