import { BadRequestException, Injectable } from "@nestjs/common";

import { DbService } from "../common/db/db.service";
import { runWithOwner } from "../common/field-crypto-context";
import { SettingsService } from "../common/settings/settings.service";
import { FoodsService } from "./foods.service";
import type { Food } from "./foods/store";
import * as meals from "./meals";
import type { CreateFoodInput, LogMealInput, MealView } from "./meals.schema";

/** Every method runs inside runWithOwner: meals.note and meal_items.name are field-encrypted (fail closed otherwise). */
@Injectable()
export class MealsService {
  constructor(private readonly dbs: DbService, private readonly settings: SettingsService, private readonly foods: FoodsService) {}

  logMeal(ownerEmail: string, input: LogMealInput): Promise<MealView> {
    return runWithOwner(ownerEmail, async () => {
      const tz = await this.settings.timezone(ownerEmail);
      return meals.logMeal(this.dbs.db, ownerEmail, tz, (ids) => this.foods.getFoods(ownerEmail, ids), input);
    });
  }

  deleteMeal(ownerEmail: string, mealId: string): Promise<{ deleted: boolean }> {
    return runWithOwner(ownerEmail, () => meals.deleteMeal(this.dbs.db, ownerEmail, mealId));
  }

  listMeals(ownerEmail: string, range: { from: string; to: string }): Promise<MealView[]> {
    return runWithOwner(ownerEmail, () => meals.listMeals(this.dbs.db, ownerEmail, range));
  }

  /** A user's own food (e.g. from a nutrition-label photo); visible only to them. */
  createFood(ownerEmail: string, food: CreateFoodInput): Promise<Food> {
    return runWithOwner(ownerEmail, async () => {
      if (food.nutrients.energy === undefined) throw new BadRequestException("A custom food needs at least energy (kcal per 100 g/ml)");
      return this.foods.createFood(ownerEmail, food);
    });
  }
}
