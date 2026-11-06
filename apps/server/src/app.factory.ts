import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express, { type ErrorRequestHandler } from "express";
import { AppModule } from "./app.module";
import { AUTH_BASE_PATH, type Auth } from "./auth/auth";
import { AUTH } from "./auth/auth.module";

/**
 * Builds the configured app without listening. bodyParser:false so BetterAuth receives the RAW
 * body on its routes; JSON parsing is re-added for every other route AFTER mounting the auth
 * handler, so Nest controller routes parse JSON but the auth routes do not. Exported (no import
 * side effects) so tests boot the real mount ordering.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const { toNodeHandler } = await import("better-auth/node");
  const { INGEST_LIMITS } = await import("@vitls/health-ingest");
  const auth = app.get<Auth>(AUTH);
  const server = app.getHttpAdapter().getInstance();
  server.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
  // Ingest carries whole-day backfills, so it needs a larger body limit than the default; this parser
  // marks the body parsed so the default express.json() below skips the route. Elsewhere the default is fine.
  server.use("/api/ingest/v1/batches", express.json({ limit: INGEST_LIMITS.maxBodyBytes }));
  // Chat carries photo attachments as base64 data URLs (the client sends only the newest message); the default
  // 100 kB limit would reject them. Marks the body parsed so the default express.json() below skips the route.
  server.use("/api/chat", express.json({ limit: "16mb" }));
  server.use(express.json());
  server.use(express.urlencoded({ extended: true }));
  // Body-parser throws before the Nest pipeline, so map its errors to the frozen device-API error
  // shape here; the global filter (common/http-exception.filter.ts) covers everything after.
  const onBadBody: ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof SyntaxError) return res.status(400).json({ error: "Invalid payload", errorCode: "invalid_payload" });
    if ((err as { type?: string }).type === "entity.too.large" || (err as { status?: number }).status === 413) {
      return res.status(413).json({ error: "Payload too large", errorCode: "payload_too_large" });
    }
    next(err);
  };
  server.use(onBadBody);
  return app;
}
