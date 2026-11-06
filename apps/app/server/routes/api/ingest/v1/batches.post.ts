/**
 * POST /api/ingest/v1/batches — device batch ingest (companion app, dev sources).
 * Auth: `Authorization: Bearer vdt_…` device token (write-only). Never uses cookies.
 * See docs/design/02-data-model-and-ingest.md §5.
 */
import { insertAuditEvent } from "@agent-native/core/audit";
import { readBodyWithSizeLimit, recordChange } from "@agent-native/core/server";
import { INGEST_LIMITS, ingestBatchSchema } from "@vitls/health-ingest";
import { defineEventHandler, getHeader } from "h3";
import { randomUUID } from "node:crypto";

import { purgeExpiredArchives } from "../../../../lib/ingest/archive";
import { touchDevice } from "../../../../lib/ingest/devices";
import { getEntitlements } from "../../../../lib/ingest/entitlements";
import { chargeIngestBytes, deviceRoute, requireDevice } from "../../../../lib/ingest/http";
import { ingestBatch } from "../../../../lib/ingest/ingest";
import { notifyFirstBatch } from "../../../../lib/ingest/first-batch";

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    // Charge the declared size before reading (covers oversized and malformed bodies); chunked bodies are charged after.
    const declared = Number(getHeader(event, "content-length"));
    const precharged = Number.isFinite(declared) && declared > 0;
    if (precharged) await chargeIngestBytes(identity, Math.min(declared, INGEST_LIMITS.maxBodyBytes));
    const body = await readBodyWithSizeLimit(event, INGEST_LIMITS.maxBodyBytes);
    if (!precharged) await chargeIngestBytes(identity, Buffer.byteLength(JSON.stringify(body)));
    const batch = ingestBatchSchema.parse(body);
    const entitlements = await getEntitlements(identity);
    const result = await ingestBatch({
      identity,
      batch,
      entitlements,
      // guard:allow-env-credential — deploy-level feature flag (never set in production), not a credential
      allowDevSources: process.env.VITLS_ENABLE_DEV_SOURCES === "1",
    });
    await touchDevice(identity.deviceId, identity);
    await notifyFirstBatch(identity, result, batch);
    await purgeExpiredArchives({ ownerEmail: identity.userEmail });

    if (!result.duplicate) {
      recordChange({ source: "health", type: "ingest", key: result.sourceId, owner: identity.userEmail, orgId: identity.orgId ?? undefined });
      await insertAuditEvent({
        id: randomUUID(),
        createdAt: Date.now(),
        action: "ingest-batch",
        caller: "http",
        actorKind: "system",
        actorEmail: identity.userEmail,
        orgId: identity.orgId,
        threadId: null,
        turnId: null,
        targetType: "health-source",
        targetId: result.sourceId,
        status: "success",
        summary: `Ingested batch from ${batch.source.provider}/${batch.source.via}: ${JSON.stringify(result.stored)}`,
        input: null,
        errorCode: null,
        ownerEmail: identity.userEmail,
        visibility: "private",
      });
    }
    return { batchId: result.batchId, duplicate: result.duplicate, stored: result.stored, skipped: result.skipped, plan: entitlements.plan };
  }),
);
