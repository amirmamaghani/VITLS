import { BadRequestException, Controller, Body, Get, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { SharesService } from "../shares/shares.service";
import { HealthService } from "./health.service";
import { BUCKETS, HEALTH_SECTIONS } from "./read";
import { RAW_SECTIONS } from "./raw";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const list = <T extends z.ZodType>(item: T) => z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(item)).optional();
const healthQuery = z.object({
  from: day,
  to: day,
  include: list(z.enum(HEALTH_SECTIONS)),
  metrics: list(z.string()),
  bucket: z.enum(BUCKETS).optional(),
  workoutTypes: list(z.string()),
});
const rawQuery = z.object({ metric: z.string().optional(), section: z.enum(RAW_SECTIONS).optional(), before: day.optional(), days: z.coerce.number().optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

const logBody = z.object({
  entries: z
    .array(z.object({ metric: z.string(), value: z.number().finite(), unit: z.string().max(10).optional(), date: day.optional(), at: z.string().datetime({ offset: true }).optional() }))
    .max(50)
    .default([]),
  workouts: z
    .array(
      z.object({
        type: z.string().max(64),
        start: z.string().datetime({ offset: true }),
        durationMin: z.number().positive().max(24 * 60),
        distanceKm: z.number().nonnegative().optional(),
        energyKcal: z.number().nonnegative().optional(),
      }),
    )
    .max(10)
    .default([]),
});

// Distinct from HealthController (/healthz liveness probe).
@Controller("api/health")
@UseGuards(AuthGuard)
export class HealthReadController {
  constructor(private readonly health: HealthService, private readonly shares: SharesService) {}

  @Get()
  async get(@CurrentUser() owner: string, @Query() q: unknown, @Query("owner") requestedOwner?: string) {
    return this.health.getHealth(await this.shares.resolveReadOwner(owner, requestedOwner), parse(healthQuery, q));
  }

  @Get("catalog")
  async catalog(@CurrentUser() owner: string, @Query("owner") requestedOwner?: string) {
    return this.health.getDataCatalog(await this.shares.resolveReadOwner(owner, requestedOwner));
  }

  @Get("raw")
  async raw(@CurrentUser() owner: string, @Query() q: unknown, @Query("owner") requestedOwner?: string) {
    return this.health.getHealthRaw(await this.shares.resolveReadOwner(owner, requestedOwner), parse(rawQuery, q));
  }

  @Post("log")
  async log(@CurrentUser() owner: string, @Body() body: unknown) {
    const input = parse(logBody, body);
    if (input.entries.length === 0 && input.workouts.length === 0) throw new BadRequestException("Nothing to log");
    return { ...(await this.health.logManual(owner, input)), message: "Logged." };
  }
}
