import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { SharesService } from "../shares/shares.service";
import { coachProfileSchema, GOAL_MODULES, PERSONAS } from "./coach.schema";
import { CoachService } from "./coach.service";

const localizationBody = z.object({ locale: z.string().min(2).max(35).optional(), timezone: z.string().min(1).max(64).optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

@Controller("api/coach")
@UseGuards(AuthGuard)
export class CoachController {
  constructor(private readonly coach: CoachService, private readonly shares: SharesService) {}

  @Get("profile")
  async getProfile(@CurrentUser() sessionUser: string, @Query("owner") requestedOwner?: string) {
    const owner = await this.shares.resolveReadOwner(sessionUser, requestedOwner);
    const [p, readout, localization] = await Promise.all([this.coach.getProfile(owner), this.coach.getReadout(owner), this.coach.getLocalization(owner)]);
    return { ...p, readout, localization, personas: PERSONAS, goalModules: GOAL_MODULES };
  }

  @Post("profile")
  async updateProfile(@CurrentUser() owner: string, @Body() body: unknown) {
    return { profile: await this.coach.updateProfile(owner, parse(coachProfileSchema, body)), message: "Coach profile updated." };
  }

  @Post("localization")
  async setLocalization(@CurrentUser() owner: string, @Body() body: unknown) {
    return { localization: await this.coach.setLocalization(owner, parse(localizationBody, body)), message: "Localization updated." };
  }
}
