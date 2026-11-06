import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../test/db";
import { getDb } from ".";

describe("food and meal tables", () => {
  beforeAll(setupTestDb);

  it("exist after migrations", async () => {
    const rows = (await getDb().execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('foods','food_nutrients','food_portions','food_names','meals','meal_items') ORDER BY table_name`,
    )) as { rows: { table_name: string }[] };
    expect(rows.rows.map((r) => r.table_name)).toEqual([
      "food_names", "food_nutrients", "food_portions", "foods", "meal_items", "meals",
    ]);
  });
});
