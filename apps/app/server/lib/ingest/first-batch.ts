/** Tells the user (push + in-app) that their phone's first health batch landed; the coach then continues onboarding. */
import { notify } from "@agent-native/core/notifications";
import { and, count, eq } from "drizzle-orm";

import { getDb, schema } from "../../db";
import type { DeviceIdentity } from "./devices";
import type { IngestResult } from "./ingest";

export async function notifyFirstBatch(identity: DeviceIdentity, result: IngestResult, batch: { daily: { date: string }[] }): Promise<boolean> {
  if (result.duplicate) return false;
  try {
    const [row] = await getDb()
      .select({ n: count() })
      .from(schema.ingestBatches)
      .where(and(eq(schema.ingestBatches.ownerEmail, identity.userEmail), eq(schema.ingestBatches.sourceId, result.sourceId)));
    if ((row?.n ?? 0) !== 1) return false;
    const days = new Set(batch.daily.map((d) => d.date)).size;
    await notify(
      {
        severity: "info",
        title: `Your phone sent ${days} ${days === 1 ? "day" : "days"} of health data`,
        body: "Open the coach to continue.",
        metadata: { url: "/home" },
        idempotencyKey: `first-batch:${result.sourceId}`,
      },
      { owner: identity.userEmail },
    );
    return true;
  } catch (error) {
    // Best-effort: the batch is already stored, so a count or notify failure must not fail the request (the retry would be a duplicate).
    console.error("[ingest] first-batch notification failed", (error as Error)?.name);
    return false;
  }
}
