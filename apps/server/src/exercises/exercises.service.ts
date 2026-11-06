import { BadRequestException, Injectable } from "@nestjs/common";

import { SettingsService } from "../common/settings/settings.service";
import { getExercise, muscleOf, searchExercises } from "./exercises";
import { sessionFor } from "./training";
import { trainingPlanSchema, type TrainingPlan } from "./training.schema";

const SETTING_KEY = "vitls-training";

@Injectable()
export class ExercisesService {
  constructor(private readonly settings: SettingsService) {}

  search(filter: Parameters<typeof searchExercises>[0]) {
    return { exercises: searchExercises(filter) };
  }

  getExercise = getExercise;
  muscleOf = muscleOf;

  async getTrainingPlan(ownerEmail: string) {
    const stored = await this.settings.get<{ plan?: unknown }>(ownerEmail, SETTING_KEY);
    const plan = stored?.plan ? trainingPlanSchema.parse(stored.plan) : null;
    const tz = await this.settings.timezone(ownerEmail);
    return { plan, today: plan ? sessionFor(plan, new Date(), tz) : null };
  }

  async saveTrainingPlan(ownerEmail: string, plan: TrainingPlan) {
    const unknown = plan.days.flatMap((d) => d.exercises).filter((e) => !getExercise(e.exerciseId));
    if (unknown.length) throw new BadRequestException(`Unknown exercise ids: ${unknown.map((e) => e.exerciseId).join(", ")}`);
    await this.settings.put(ownerEmail, SETTING_KEY, { plan, updatedAt: new Date().toISOString() });
    return { plan, message: "Training plan saved." };
  }
}
