import { BadRequestException, Injectable } from "@nestjs/common";

import { DbService } from "../common/db/db.service";
import { runWithOwner } from "../common/field-crypto-context";
import { SettingsService } from "../common/settings/settings.service";
import { IngestService } from "../ingest/ingest.service";
import { MealsService } from "../meals/meals.service";
import { getDataCatalog, type DataCatalog } from "./catalog";
import { getHealthRaw, type RawQuery, type RawResult } from "./raw";
import { logManual, type ManualWorkout } from "./manual";
import { getHealth, type HealthQuery } from "./read";

@Injectable()
export class HealthService {
  constructor(private readonly dbs: DbService, private readonly meals: MealsService,
    private readonly ingest: IngestService,
    private readonly settings: SettingsService,
  ) {}

  private readonly listMeals = (owner: string, range: { from: string; to: string }) => this.meals.listMeals(owner, range);

  // Sleep stages, workout sets and meals are encrypted columns: reads decrypt inside the owner context.
  getHealth(ownerEmail: string, query: HealthQuery) {
    return runWithOwner(ownerEmail, () => getHealth(this.dbs.db, this.listMeals, ownerEmail, query));
  }

  getDataCatalog(ownerEmail: string): Promise<DataCatalog> {
    return getDataCatalog(this.dbs.db, ownerEmail);
  }

  getHealthRaw(ownerEmail: string, query: RawQuery): Promise<RawResult> {
    return runWithOwner(ownerEmail, () => getHealthRaw(this.dbs.db, this.listMeals, ownerEmail, query));
  }

  /** Entries default to today (owner timezone); `at` overrides `date` for measurements. */
  async logManual(
    ownerEmail: string,
    input: { entries?: { metric: string; value: number; unit?: string; date?: string; at?: string }[]; workouts?: ManualWorkout[] },
  ): Promise<{ stored: number }> {
    const entries = input.entries ?? [];
    const workouts = input.workouts ?? [];
    if (entries.length > 50 || workouts.length > 10) throw new BadRequestException("At most 50 entries and 10 workouts per call");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: await this.settings.timezone(ownerEmail) });
    const { stored } = await logManual(this.ingest, ownerEmail, {
      entries: entries.map((e) => ({ metric: e.metric, value: e.value, unit: e.unit, when: e.at ?? e.date ?? today })),
      workouts,
    });
    return { stored: stored.daily + stored.points + stored.workouts };
  }
}
