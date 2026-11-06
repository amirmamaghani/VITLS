import { randomBytes } from "node:crypto";

import { eq, sql as rawSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";

import { runWithOwner } from "../common/field-crypto-context";
import { configureFieldKeys, parseFieldKeys } from "./encrypted";
import * as schema from "./schema";

const sql = postgres(process.env.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL is required"); })());
const db = drizzle(sql, { schema });
const OWNER = "meals-barrier@x.co";
const now = "2026-01-01T00:00:00Z";

beforeAll(() => configureFieldKeys(parseFieldKeys(`k1:${randomBytes(32).toString("base64")}`)));
afterAll(async () => {
  await db.delete(schema.mealItems).where(eq(schema.mealItems.ownerEmail, OWNER));
  await db.delete(schema.meals).where(eq(schema.meals.ownerEmail, OWNER));
  configureFieldKeys(undefined);
  await sql.end();
});

test("meals.note and meal_items.name are ciphertext at rest and fail closed outside an owner context", async () => {
  await runWithOwner(OWNER, async () => {
    await db.insert(schema.meals).values({
      id: "m-barrier", eatenAt: new Date(), localDate: "2026-01-01", note: "secret note",
      entry: "manual", createdAt: now, updatedAt: now, ownerEmail: OWNER,
    });
    await db.insert(schema.mealItems).values({
      id: "mi-barrier", mealId: "m-barrier", position: 0, name: "secret food", amount: 100,
      unit: "g", nutrients: "{}", ownerEmail: OWNER,
    });
  });

  const [meal] = await db.execute<{ note: string }>(rawSql`select note from meals where id = 'm-barrier'`);
  const [item] = await db.execute<{ name: string }>(rawSql`select name from meal_items where id = 'mi-barrier'`);
  expect(meal!.note.startsWith("enc:v1:")).toBe(true);
  expect(item!.name.startsWith("enc:v1:")).toBe(true);

  // Writing without an owner context must refuse rather than store plaintext.
  await expect(
    db.insert(schema.meals).values({
      id: "m-leak", eatenAt: new Date(), localDate: "2026-01-01", note: "x",
      entry: "manual", createdAt: now, updatedAt: now, ownerEmail: OWNER,
    }),
  ).rejects.toThrow(/owner context/);
});
