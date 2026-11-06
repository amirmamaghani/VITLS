import { describe, expect, it } from "vitest";

import {
  dailyMetrics,
  devicePairings,
  deviceTokens,
  healthSources,
  ingestBatches,
  intradaySeries,
  pointMetrics,
  rateLimits,
  sleepSessions,
  workouts,
} from "./schema";

describe("device tables", () => {
  it("expose the frozen columns", () => {
    expect(Object.keys(deviceTokens)).toEqual(
      expect.arrayContaining([
        "id",
        "tokenHash",
        "tokenPrefix",
        "label",
        "platform",
        "scope",
        "createdAt",
        "lastUsedAt",
        "revokedAt",
        "ownerEmail",
      ]),
    );
    expect(Object.keys(devicePairings)).toEqual(
      expect.arrayContaining(["id", "codeHash", "expiresAt", "consumedAt", "createdAt", "ownerEmail"]),
    );
    expect(Object.keys(rateLimits)).toEqual(expect.arrayContaining(["key", "windowStart", "count"]));
  });
});

describe("ingest + health tables", () => {
  const ownerScoped = { healthSources, dailyMetrics, pointMetrics, sleepSessions, workouts, intradaySeries, ingestBatches };

  it("exist and carry ownerEmail, never orgId", () => {
    for (const [name, table] of Object.entries(ownerScoped)) {
      const cols = Object.keys(table);
      expect(cols, name).toContain("ownerEmail");
      expect(cols, name).not.toContain("orgId");
      expect(cols, name).not.toContain("visibility");
    }
  });

  it("keep the encrypted/key columns", () => {
    expect(Object.keys(sleepSessions)).toEqual(expect.arrayContaining(["id", "sourceId", "externalId", "stages", "ownerEmail"]));
    expect(Object.keys(workouts)).toEqual(expect.arrayContaining(["type", "startAt", "endAt", "sets", "ownerEmail"]));
    expect(Object.keys(ingestBatches)).toEqual(expect.arrayContaining(["batchId", "raw", "rawExpiresAt", "ownerEmail"]));
    expect(Object.keys(dailyMetrics)).toEqual(expect.arrayContaining(["sourceId", "day", "metric", "value", "unit", "ownerEmail"]));
    expect(Object.keys(pointMetrics)).toEqual(expect.arrayContaining(["sourceId", "externalId", "at", "metric", "value", "ownerEmail"]));
    expect(Object.keys(intradaySeries)).toEqual(expect.arrayContaining(["sourceId", "metric", "day", "startAt", "intervalS", "values", "ownerEmail"]));
    expect(Object.keys(healthSources)).toEqual(expect.arrayContaining(["id", "provider", "via", "deviceTokenId", "status", "ownerEmail"]));
  });
});
