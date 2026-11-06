/**
 * Retention for the encrypted raw batch archive (`ingest_batches.raw`, see design §4).
 * Runs opportunistically per owner on every ingest and globally via `pnpm purge:archives` (schedule it on the host).
 */
import { and, eq, isNotNull, lt } from "drizzle-orm";

import { getDb, schema } from "../../db";

export async function purgeExpiredArchives(scope: { ownerEmail?: string } = {}): Promise<number> {
  const t = schema.ingestBatches;
  const expired = and(isNotNull(t.raw), lt(t.rawExpiresAt, new Date().toISOString()));
  const purged = await getDb()
    .update(t)
    .set({ raw: null, rawExpiresAt: null })
    // guard:allow-unscoped — retention sweep: either the caller's own rows (ownerEmail) or the host-scheduled global purge
    .where(scope.ownerEmail ? and(eq(t.ownerEmail, scope.ownerEmail), expired) : expired)
    .returning({ id: t.id });
  return purged.length;
}
