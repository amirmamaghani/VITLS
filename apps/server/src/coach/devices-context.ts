/** Deterministic <devices> block for the coach prompt: what is paired, when data last arrived, what the goals still lack. */
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { DbService } from "../common/db/db.service";
import { dailyMetrics, deviceTokens, ingestBatches, pointMetrics } from "../db/schema";

export async function devicesContext(db: DbService, ownerEmail: string, goalMetrics: string[]): Promise<string> {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const [devices, [batch], daily, points] = await Promise.all([
    db.db.select({ platform: deviceTokens.platform, label: deviceTokens.label }).from(deviceTokens)
      .where(and(eq(deviceTokens.ownerEmail, ownerEmail), isNull(deviceTokens.revokedAt))),
    db.db.select({ at: ingestBatches.receivedAt }).from(ingestBatches)
      .where(eq(ingestBatches.ownerEmail, ownerEmail)).orderBy(desc(ingestBatches.receivedAt)).limit(1),
    goalMetrics.length
      ? db.db.selectDistinct({ metric: dailyMetrics.metric }).from(dailyMetrics).where(and(
          eq(dailyMetrics.ownerEmail, ownerEmail), inArray(dailyMetrics.metric, goalMetrics), gte(dailyMetrics.day, since.toISOString().slice(0, 10))))
      : [],
    goalMetrics.length
      ? db.db.selectDistinct({ metric: pointMetrics.metric }).from(pointMetrics).where(and(
          eq(pointMetrics.ownerEmail, ownerEmail), inArray(pointMetrics.metric, goalMetrics), gte(pointMetrics.at, since)))
      : [],
  ]);
  const have = new Set([...daily, ...points].map((r) => r.metric));
  const missing = goalMetrics.filter((m) => !have.has(m));
  return [
    "<devices>",
    devices.length
      ? `paired: ${devices.map((d) => `${d.platform ?? "unknown"}${d.label ? ` (${d.label})` : ""}`).join(", ")}`
      : "paired: no device paired yet — offer the companion app in the data stage",
    `last batch: ${batch?.at ?? "never"}`,
    `goal metrics with no data in the last 14 days: ${missing.length ? missing.join(", ") : "none"}`,
    "</devices>",
  ].join("\n");
}
