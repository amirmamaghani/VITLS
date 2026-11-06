import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { DbService } from "../common/db/db.service";
import type { OffFetch } from "./foods/off";
import { searchFoods } from "./foods/search";
import { getFoods, upsertFoods, type Food, type ImportedFood } from "./foods/store";

/** Shared food reference catalog (not owner-encrypted); ownerEmail only gates custom foods. */
@Injectable()
export class FoodsService {
  constructor(private readonly dbs: DbService) {}

  search(ownerEmail: string, input: { query?: string; barcode?: string; limit?: number; fetcher?: OffFetch; timeoutMs?: number }): Promise<Food[]> {
    return searchFoods(this.dbs.db, { ...input, viewer: ownerEmail });
  }

  getFoods(ownerEmail: string, ids: string[]): Promise<Map<string, Food>> {
    return getFoods(this.dbs.db, ids, ownerEmail);
  }

  upsertFoods(rows: ImportedFood[]) {
    return upsertFoods(this.dbs.db, rows);
  }

  async createFood(ownerEmail: string, food: Omit<ImportedFood, "source" | "sourceRef" | "createdBy">): Promise<Food> {
    const { ids } = await upsertFoods(this.dbs.db, [{ ...food, source: "custom", sourceRef: randomUUID(), createdBy: ownerEmail }]);
    return (await getFoods(this.dbs.db, ids, ownerEmail)).get(ids[0]!)!;
  }
}
