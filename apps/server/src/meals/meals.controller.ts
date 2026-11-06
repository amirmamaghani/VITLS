import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { SharesService } from "../shares/shares.service";
import { FoodsService } from "./foods.service";
import { mealSchemas } from "./meals.schema";
import { MealsService } from "./meals.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeQuery = z.object({ from: day, to: day });
const foodQuery = z
  .object({ query: z.string().trim().min(2).max(120).optional(), barcode: z.string().regex(/^\d{8,14}$/).optional(), limit: z.coerce.number().int().min(1).max(25).optional() })
  .refine((v) => v.query || v.barcode, "Pass query or barcode");

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

@Controller("api/meals")
@UseGuards(AuthGuard)
export class MealsController {
  constructor(private readonly meals: MealsService, private readonly foods: FoodsService, private readonly shares: SharesService) {}

  @Post()
  async log(@CurrentUser() owner: string, @Body() body: unknown) {
    return this.meals.logMeal(owner, parse((await mealSchemas()).logMeal, body));
  }

  @Get()
  async list(@CurrentUser() owner: string, @Query() q: unknown, @Query("owner") requestedOwner?: string) {
    return this.meals.listMeals(await this.shares.resolveReadOwner(owner, requestedOwner), parse(rangeQuery, q));
  }

  // Declared before ":id" routes; "foods" never collides with DELETE :id.
  @Post("foods")
  async createFood(@CurrentUser() owner: string, @Body() body: unknown) {
    return this.meals.createFood(owner, parse((await mealSchemas()).createFood, body));
  }

  @Get("foods")
  searchFoods(@CurrentUser() owner: string, @Query() q: unknown) {
    return this.foods.search(owner, parse(foodQuery, q));
  }

  @Delete(":id")
  remove(@CurrentUser() owner: string, @Param("id") id: string) {
    return this.meals.deleteMeal(owner, id);
  }
}
