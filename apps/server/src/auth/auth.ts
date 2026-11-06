import expressLib, { type Express } from "express";

import type { DbService } from "../common/db/db.service";

/** What BetterAuth needs from the mail layer (MailService satisfies this). */
export interface Mailer {
  send(message: { to: string; subject: string; html: string }): Promise<void>;
}

/**
 * Public mount point. BetterAuth's generated magic-link URLs are built from BETTER_AUTH_URL +
 * this basePath, so keeping the `/_vitls` framework prefix makes callback links stable (MEMORY:
 * no `_agent-native`, prefix remapped to `/_vitls`). Routes hang off it, e.g.
 * POST `${AUTH_BASE_PATH}/sign-in/magic-link`, GET `${AUTH_BASE_PATH}/magic-link/verify`.
 */
export const AUTH_BASE_PATH = "/_vitls/auth";

function magicLinkEmail(url: string): string {
  return `<p>Sign in to VITLS by clicking <a href="${url}">this link</a>.</p><p>Or paste: ${url}</p><p>The link expires in 5 minutes.</p>`;
}

// better-auth is ESM-only; this package compiles to CommonJS (module: node16), so its value
// exports are reached via dynamic import rather than a static one (TS1479 / ERR_REQUIRE_ESM).
export type Auth = Awaited<ReturnType<typeof buildAuth>>;

/** Builds the BetterAuth instance over the shared drizzle (postgres-js) connection. */
export async function buildAuth(db: DbService["db"], mail: Mailer) {
  const { betterAuth } = await import("better-auth");
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  const { magicLink } = await import("better-auth/plugins/magic-link");
  const { bearer } = await import("better-auth/plugins");
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    plugins: [
      bearer(), // native app: `Authorization: Bearer <token>` works in getSession; token returned in `set-auth-token`
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await mail.send({ to: email, subject: "Sign in to VITLS", html: magicLinkEmail(url) });
        },
      }),
    ],
  });
}

/**
 * Standalone Express app that mounts the auth handler and nothing else. Used by the test and
 * reusable for mounting on NestJS's underlying Express instance. The handler is mounted WITHOUT
 * a body parser in front of it: BetterAuth reads the raw request body itself, so no
 * `express.json()` may run first on these routes.
 */
export async function buildAuthApp(db: DbService["db"], mail: Mailer): Promise<Express> {
  const { toNodeHandler } = await import("better-auth/node");
  const app = expressLib();
  app.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(await buildAuth(db, mail)));
  return app;
}
