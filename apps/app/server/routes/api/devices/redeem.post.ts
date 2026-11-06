/**
 * POST /api/devices/redeem — exchanges a one-time pairing code for a write-only device token.
 * Public (no session): the pairing code is the credential, so attempts are throttled per client and globally.
 * See docs/design/02-data-model-and-ingest.md §5.
 */
import { readBodyWithSizeLimit } from "@agent-native/core/server";
import { deviceLabelSchema } from "@vitls/health-ingest";
import { defineEventHandler } from "h3";
import { z } from "zod";

import { redeemPairing } from "../../../lib/ingest/devices";
import { deviceRoute, throttleRedeem } from "../../../lib/ingest/http";

const bodySchema = z.object({
  code: z.string().min(12).max(20),
  device: z.object({
    platform: z.enum(["ios", "android", "cli"]),
    model: deviceLabelSchema.optional(),
    appVersion: deviceLabelSchema.optional(),
  }),
});

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    await throttleRedeem(event);
    const body = bodySchema.parse(await readBodyWithSizeLimit(event, 4 * 1024));
    const { token, deviceId } = await redeemPairing(body.code, body.device);
    return { token, deviceId, ingestUrl: "/api/ingest/v1/batches" };
  }),
);
