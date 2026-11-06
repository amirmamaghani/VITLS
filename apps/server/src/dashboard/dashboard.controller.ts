import { randomUUID } from "node:crypto";

import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { SharesService } from "../shares/shares.service";
import { DashboardStore } from "./dashboard.store";

// @vitls/dashboard is ESM-only; values load via dynamic import (memoized).
let dashboardPkg: Promise<typeof import("@vitls/dashboard", { with: { "resolution-mode": "import" } })> | undefined;
const pkg = () => (dashboardPkg ??= import("@vitls/dashboard"));

const createBody = z.object({ title: z.string().trim().min(1).max(80) });
const saveBody = z.object({ title: z.string().trim().min(1).max(80).default("Dashboard"), config: z.unknown(), expectedUpdatedAt: z.string().optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

@Controller("api/dashboards")
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly store: DashboardStore, private readonly shares: SharesService) {}

  private async requireDashboard(id: string, owner: string) {
    const d = await this.store.get(id, owner);
    if (!d || d.archivedAt) throw new NotFoundException(`Dashboard "${id}" not found.`);
    return d;
  }

  @Get()
  async list(@CurrentUser() sessionUser: string, @Query("owner") requestedOwner?: string) {
    const owner = await this.shares.resolveReadOwner(sessionUser, requestedOwner);
    let boards = await this.store.list(owner);
    if (boards.length === 0 && owner === sessionUser) { // never seed a board in someone else's account
      // Lazy seed so the list is never empty; deterministic id keeps concurrent first loads idempotent-ish.
      const { EMPTY_DASHBOARD } = await pkg();
      boards = [await this.store.write({ id: this.store.defaultDashboardId(owner), kind: "health", title: "Dashboard", config: EMPTY_DASHBOARD, ownerEmail: owner })];
    }
    return boards.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  }

  @Post()
  async create(@CurrentUser() owner: string, @Body() body: unknown) {
    const { title } = parse(createBody, body);
    const { EMPTY_DASHBOARD } = await pkg();
    return this.store.write({ id: `dashboard-${randomUUID()}`, kind: "health", title, config: EMPTY_DASHBOARD, ownerEmail: owner });
  }

  @Get(":id")
  async get(@CurrentUser() owner: string, @Param("id") id: string, @Query("owner") requestedOwner?: string) {
    return this.requireDashboard(id, await this.shares.resolveReadOwner(owner, requestedOwner));
  }

  @Post(":id")
  async save(@CurrentUser() owner: string, @Param("id") id: string, @Body() body: unknown) {
    const { title, config, expectedUpdatedAt } = parse(saveBody, body);
    const { dashboardConfigSchema } = await pkg();
    const parsed = dashboardConfigSchema.safeParse(config); // before write: a rejected save leaves no revision
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    await this.requireDashboard(id, owner);
    return this.store.write({ id, kind: "health", title, config: parsed.data, ownerEmail: owner, expectedUpdatedAt });
  }

  @Post(":id/archive")
  async archive(@CurrentUser() owner: string, @Param("id") id: string) {
    await this.requireDashboard(id, owner);
    return this.store.archive(id, owner);
  }

  @Get(":id/revisions")
  async revisions(@CurrentUser() sessionUser: string, @Param("id") id: string, @Query("owner") requestedOwner?: string) {
    const owner = await this.shares.resolveReadOwner(sessionUser, requestedOwner);
    await this.requireDashboard(id, owner);
    return this.store.listRevisionMetadata(id, owner);
  }

  @Post(":id/revisions/:revisionId/restore")
  async restore(@CurrentUser() owner: string, @Param("id") id: string, @Param("revisionId") revisionId: string) {
    const restored = await this.store.restore(id, revisionId, owner);
    if (!restored) throw new NotFoundException("Dashboard revision not found.");
    return restored;
  }
}
