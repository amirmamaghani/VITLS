import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ExercisesService } from "./exercises.service";
import { trainingPlanSchema } from "./training.schema";

const searchQuery = z.object({
  query: z.string().max(120).optional(),
  bodyPart: z.string().max(60).optional(),
  equipment: z.string().max(60).optional(),
  target: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const saveBody = z.object({ plan: trainingPlanSchema });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

@Controller("api/exercises")
@UseGuards(AuthGuard)
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  search(@Query() q: unknown) {
    return this.exercises.search(parse(searchQuery, q));
  }

  @Get("plan")
  plan(@CurrentUser() owner: string) {
    return this.exercises.getTrainingPlan(owner);
  }

  @Post("plan")
  savePlan(@CurrentUser() owner: string, @Body() body: unknown) {
    return this.exercises.saveTrainingPlan(owner, parse(saveBody, body).plan);
  }
}
