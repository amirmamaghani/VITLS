import { Injectable, Logger } from "@nestjs/common";
import { DashboardStore } from "../dashboard/dashboard.store";
import { DevicesService } from "../devices/devices.service";
import { PushService } from "../devices/push.service";
import { ExercisesService } from "../exercises/exercises.service";
import { HealthService } from "../health/health.service";
import { FoodsService } from "../meals/foods.service";
import { MealsService } from "../meals/meals.service";
import { CoachService } from "./coach.service";
import { MemoriesService } from "./memories.service";
import { coachModel } from "./model";
import { buildCoachTools } from "./tools";

/** Local calendar date (YYYY-MM-DD) and zero-padded HH:MM in an IANA timezone. Throws RangeError on a bad zone. */
export function localDateTime(now: Date, timeZone: string): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const SYSTEM = `You generate the user's morning readout. Follow this flow exactly:
1. Call get-coach-profile, then get-health for the last 30 days (from/to in the user's timezone).
2. Compose in the user's persona, strictness and language: a directive of at most 120 words (one actionable focus for today), a short greeting addressing them by first name, and at most 3 highlights, each a metric key with a short note. Take every number from get-health; never invent values.
3. Call save-readout with date = the local date given by the user, plus directive, greeting, highlights.
4. Call manage-notifications with title = a short headline and body = the readout, to push it.
Do not ask questions. Finish after the notification is sent.`;

@Injectable()
export class ReadoutService {
  private readonly log = new Logger(ReadoutService.name);

  constructor(
    private readonly coach: CoachService,
    private readonly health: HealthService,
    private readonly foods: FoodsService,
    private readonly meals: MealsService,
    private readonly exercises: ExercisesService,
    private readonly dashboards: DashboardStore,
    private readonly devices: DevicesService,
    private readonly memories: MemoriesService,
    private readonly push: PushService,
  ) {}

  /** The agent's own save-readout / manage-notifications calls persist and push; on any failure nothing is saved. */
  async generateFor(ownerEmail: string): Promise<{ generated: boolean }> {
    try {
      const { generateText, stepCountIs } = await import("ai");
      const model = await coachModel();
      const { profile } = await this.coach.getProfile(ownerEmail);
      const localDate = localDateTime(new Date(), profile.timezone ?? "UTC").date;
      await generateText({
        model,
        system: SYSTEM,
        messages: [{ role: "user", content: `Generate my morning readout for ${localDate}.` }],
        tools: await buildCoachTools(ownerEmail, {
          coach: this.coach, health: this.health, foods: this.foods, meals: this.meals, exercises: this.exercises,
          dashboards: this.dashboards, devices: this.devices, memories: this.memories, push: this.push,
        }),
        stopWhen: stepCountIs(8),
      });
      // Only a persisted readout for today counts; a model that skipped save-readout is not-generated.
      return { generated: (await this.coach.getReadout(ownerEmail))?.date === localDate };
    } catch (e) {
      this.log.error(`readout generation failed: ${e instanceof Error ? e.constructor.name : typeof e}`);
      return { generated: false };
    }
  }
}
