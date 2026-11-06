import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { userSettings } from "../db/schema";
import { CoachService } from "./coach.service";
import { coachProfileSchema } from "./coach.schema";
import { hasCoachKey } from "./model";
import { localDateTime, ReadoutService } from "./readout.service";

/** A failed or no-save owner stays due all day; retry at most this often. */
const COOLDOWN_MS = 30 * 60 * 1000;

@Injectable()
export class ReadoutCron {
  private readonly log = new Logger(ReadoutCron.name);
  private warned = false;
  private readonly inFlight = new Set<string>();
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    private readonly dbs: DbService,
    private readonly coach: CoachService,
    private readonly readout: ReadoutService,
  ) {}

  protected now(): Date {
    return new Date();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTick(): Promise<void> {
    if (!hasCoachKey()) {
      if (!this.warned) this.log.warn("No coach model key; morning readouts disabled");
      this.warned = true;
      return;
    }
    const rows = await this.dbs.db.select().from(userSettings).where(eq(userSettings.key, "vitls-coach"));
    const now = this.now();
    const nowMs = now.getTime();
    for (const row of rows) {
      try {
        const profile = coachProfileSchema.safeParse(row.value);
        if (!profile.success || !profile.data.readoutTime || !profile.data.timezone) continue;
        const local = localDateTime(now, profile.data.timezone);
        // Zero-padded HH:MM compares correctly as a string; the saved readout's date is the once-per-local-day guard.
        if (local.time < profile.data.readoutTime) continue;
        if ((await this.coach.getReadout(row.ownerEmail))?.date === local.date) continue;
        const owner = row.ownerEmail;
        if (this.inFlight.has(owner) || (this.cooldownUntil.get(owner) ?? 0) > nowMs) continue;
        this.inFlight.add(owner);
        let generated = false;
        try {
          generated = (await this.readout.generateFor(owner)).generated;
        } finally {
          this.inFlight.delete(owner);
          if (!generated) this.cooldownUntil.set(owner, nowMs + COOLDOWN_MS);
        }
      } catch (e) {
        this.log.error(`readout tick failed: ${e instanceof Error ? e.constructor.name : typeof e}`);
      }
    }
  }
}
