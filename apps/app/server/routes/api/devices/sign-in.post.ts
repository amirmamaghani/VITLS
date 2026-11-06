/**
 * POST /api/devices/sign-in — the companion asks for a magic-link e-mail. Public; throttled like pairing. Forwards to the
 * framework's own magic-link route so the app never spells that route out; the link in the e-mail opens the companion
 * (App/Universal Link on the whole domain) and signs the Coach WebView in.
 */
import { ActionContractError } from "@agent-native/core/action";
import { FRAMEWORK_ROUTE_PREFIX, readBodyWithSizeLimit } from "@agent-native/core/server";
import { defineEventHandler, getRequestURL } from "h3";
import { z } from "zod";

import appConfig from "../../../../agent-native.config";
import { deviceRoute, throttleRedeem } from "../../../lib/ingest/http";

const bodySchema = z.object({ email: z.string().email().max(200) });
/** The framework's magic-link route under the public prefix this deployment serves it on (agent-native.config.ts). */
const publicPrefix = (appConfig as { runtime?: { frameworkRoutePrefix?: string } }).runtime?.frameworkRoutePrefix;
export const MAGIC_LINK_ROUTE = `${publicPrefix ?? FRAMEWORK_ROUTE_PREFIX}/auth/magic-link`;

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    await throttleRedeem(event);
    const { email } = bodySchema.parse(await readBodyWithSizeLimit(event, 2 * 1024));
    const res = await fetch(new URL(MAGIC_LINK_ROUTE, getRequestURL(event).origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/home" }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ActionContractError(json.error ?? "Could not send the sign-in link", { errorCode: "sign_in_failed", statusCode: res.status });
    }
    return { ok: true };
  }),
);
