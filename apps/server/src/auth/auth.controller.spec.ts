import type { AddressInfo } from "node:net";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, expect, test } from "vitest";

import * as schema from "../db/schema";
import { buildAuthApp } from "./auth";

// BetterAuth needs these at instance construction; test values only.
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-32-chars-long-000000";
process.env.BETTER_AUTH_URL ??= "http://localhost:3001";

const sql = postgres(process.env.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL is required"); })());
const db = drizzle(sql, { schema });
const EMAIL = "a@b.co";

afterAll(async () => {
  await db.delete(schema.user).where(eq(schema.user.email, EMAIL)); // cascades account + session
  await sql.end();
});

test("POST /_vitls/auth/sign-in/magic-link sends a mail with the link", async () => {
  const sent: { to: string; subject: string; html: string }[] = [];
  const app = await buildAuthApp(db, { send: async (m) => void sent.push(m) });
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/_vitls/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, callbackURL: "/home" }),
    });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(message.to).toBe(EMAIL);
    expect(message.html).toMatch(/http/);

    // Clean up the verification row (identifier is the plain token carried in the link).
    const token = new URL(message.html.match(/https?:\/\/[^"'\s]+/)![0]).searchParams.get("token");
    if (token) await db.delete(schema.verification).where(eq(schema.verification.identifier, token));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
