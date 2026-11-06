import { createHash, randomUUID } from "node:crypto";

import { ConflictException, Injectable } from "@nestjs/common";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { DbService } from "../common/db/db.service";
import { dashboardRevisions, dashboards } from "../db/schema";

// @vitls/dashboard is ESM-only; this CJS server types against it via import() (same pattern as @vitls/health-ingest).
type DashboardConfig = import("@vitls/dashboard", { with: { "resolution-mode": "import" } }).DashboardConfig;

export interface DashboardRecord {
  id: string;
  kind: "health";
  title: string;
  config: DashboardConfig;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
}

export interface DashboardRevision {
  id: string;
  dashboardId: string;
  kind: "health";
  title: string;
  config: DashboardConfig;
  ownerEmail: string;
  createdAt: string;
  createdBy: string | null;
  chatContext: unknown;
}

export type DashboardRevisionMetadata = Omit<DashboardRevision, "config">;

/** The drizzle transaction handle passed to `db.transaction(cb)`. */
type Tx = Parameters<Parameters<DbService["db"]["transaction"]>[0]>[0];

export interface DashboardWrite {
  id: string;
  kind: "health";
  title: string;
  config: DashboardConfig;
  ownerEmail: string;
  updatedBy?: string;
  chatContext?: unknown;
  /** Optimistic lock: the updatedAt the caller last read; a mismatch rejects the write (ConflictException). */
  expectedUpdatedAt?: string;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** A stable key for comparing two JSON configs regardless of key order. */
function comparableConfig(config: DashboardConfig): string {
  const canon = (value: unknown): unknown =>
    value === null || typeof value !== "object"
      ? value
      : Array.isArray(value)
        ? value.map(canon)
        : Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, canon((value as Record<string, unknown>)[k])]));
  return JSON.stringify(canon(config));
}

/** Monotonic revision timestamp so newest-first ordering never ties within the same millisecond. */
function nextRevisionTimestamp(previous: string | undefined): string {
  const previousMs = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Math.max(Date.now(), Number.isFinite(previousMs) ? previousMs + 1 : 0)).toISOString();
}

/**
 * Owner-scoped dashboard storage: reimplements agent-native `createDashboardStorage` over DbService.
 * `ownerEmail` replaces the framework AccessContext (no sharing in this plan); config is plaintext JSON.
 */
@Injectable()
export class DashboardStore {
  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  /** The owner's dashboard by id, or null (a cross-owner id returns null, never another owner's row). */
  async get(id: string, ownerEmail: string): Promise<DashboardRecord | null> {
    const [row] = await this.db
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.ownerEmail, normalizeEmail(ownerEmail))))
      .limit(1);
    return row ? this.recordFromRow(row) : null;
  }

  async list(ownerEmail: string, archive: "active" | "archived" | "all" = "active"): Promise<DashboardRecord[]> {
    const owner = eq(dashboards.ownerEmail, normalizeEmail(ownerEmail));
    const where =
      archive === "all"
        ? owner
        : and(owner, archive === "active" ? isNull(dashboards.archivedAt) : isNotNull(dashboards.archivedAt));
    const rows = await this.db.select().from(dashboards).where(where).orderBy(desc(dashboards.updatedAt));
    return rows.map((row) => this.recordFromRow(row));
  }

  /**
   * Upsert a dashboard. A new id inserts; an existing row is snapshotted into a revision and then updated,
   * both inside one transaction. When `expectedUpdatedAt` is given, the update is guarded (hand-rolled optimistic
   * lock); a stale value aborts the transaction so nothing is written — not the update and not the revision.
   * The affected-rows check reads the returned rows, not a driver rowCount (postgres.js reports `count`, which
   * agent-native's store misses — docs/upstream/agent-native-dashboard-storage-affected-rows.md).
   */
  async write(input: DashboardWrite): Promise<DashboardRecord> {
    const ownerEmail = normalizeEmail(input.ownerEmail);
    const existing = await this.get(input.id, ownerEmail);
    const config = JSON.stringify(input.config);

    if (!existing) {
      if (input.expectedUpdatedAt !== undefined) throw new ConflictException(`Dashboard "${input.id}" changed between read and write.`);
      const now = new Date().toISOString();
      await this.db.insert(dashboards).values({
        id: input.id,
        kind: input.kind,
        title: input.title,
        config,
        ownerEmail,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.updatedBy ?? null,
      });
      return (await this.get(input.id, ownerEmail))!;
    }

    // Identical content is a no-op: no new revision, no bumped updatedAt.
    if (existing.title === input.title && comparableConfig(existing.config) === comparableConfig(input.config)) return existing;

    const updatedAt = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await this.snapshot(tx, existing, input.updatedBy ?? null, input.chatContext);
      const guard = input.expectedUpdatedAt !== undefined ? eq(dashboards.updatedAt, input.expectedUpdatedAt) : undefined;
      const updated = await tx
        .update(dashboards)
        .set({ kind: input.kind, title: input.title, config, updatedAt, updatedBy: input.updatedBy ?? null })
        .where(and(eq(dashboards.id, input.id), eq(dashboards.ownerEmail, ownerEmail), guard))
        .returning({ id: dashboards.id });
      // postgres.js returns no rowCount; the returned rows ARE the affected-row count. 0 → stale lock → roll back.
      if (updated.length === 0) throw new ConflictException(`Dashboard "${input.id}" changed between read and write.`);
    });
    return (await this.get(input.id, ownerEmail))!;
  }

  async listRevisions(id: string, ownerEmail: string): Promise<DashboardRevision[]> {
    const rows = await this.revisionRows(id, ownerEmail);
    return rows.map((row) => this.revisionFromRow(row));
  }

  async listRevisionMetadata(id: string, ownerEmail: string): Promise<DashboardRevisionMetadata[]> {
    const rows = await this.revisionRows(id, ownerEmail);
    return rows.map((row) => {
      const { config: _config, ...meta } = this.revisionFromRow(row);
      return meta;
    });
  }

  /** Restore a revision's title/config onto the dashboard (snapshotting the current version first); null if the revision is missing. */
  async restore(id: string, revisionId: string, ownerEmail: string): Promise<DashboardRecord | null> {
    const owner = normalizeEmail(ownerEmail);
    const existing = await this.get(id, owner);
    if (!existing) return null;
    const [row] = await this.db
      .select()
      .from(dashboardRevisions)
      .where(and(eq(dashboardRevisions.id, revisionId), eq(dashboardRevisions.dashboardId, id), eq(dashboardRevisions.ownerEmail, owner)))
      .limit(1);
    if (!row) return null;
    const revision = this.revisionFromRow(row);
    return this.write({ id, kind: revision.kind, title: revision.title, config: revision.config, ownerEmail: owner, expectedUpdatedAt: existing.updatedAt });
  }

  /**
   * Archive a dashboard. Guarded so the owner cannot archive their last active dashboard: a single conditional
   * UPDATE whose sub-select requires another active row to remain (ported from archive-dashboard.ts, minus org_id).
   * 0 rows affected → ConflictException (the last active dashboard, already archived, or not the owner's).
   */
  async archive(id: string, ownerEmail: string): Promise<DashboardRecord> {
    const owner = normalizeEmail(ownerEmail);
    const archived = await this.db
      .update(dashboards)
      .set({ archivedAt: new Date().toISOString() })
      .where(
        and(
          eq(dashboards.id, id),
          eq(dashboards.ownerEmail, owner),
          isNull(dashboards.archivedAt),
          sql`(select count(*) from vitls_dashboards d where d.owner_email = ${owner} and d.archived_at is null) > 1`,
        ),
      )
      .returning();
    if (archived.length === 0) throw new ConflictException("The last dashboard cannot be archived.");
    return this.recordFromRow(archived[0]!);
  }

  /** Deterministic default-dashboard id for an owner (single-tenant: the org segment collapses to "personal"). */
  defaultDashboardId(ownerEmail: string): string {
    return `dashboard-${createHash("sha256").update(`personal:${normalizeEmail(ownerEmail)}`).digest("hex").slice(0, 24)}`;
  }

  private async revisionRows(id: string, ownerEmail: string) {
    return this.db
      .select()
      .from(dashboardRevisions)
      .where(and(eq(dashboardRevisions.dashboardId, id), eq(dashboardRevisions.ownerEmail, normalizeEmail(ownerEmail))))
      .orderBy(desc(dashboardRevisions.createdAt), desc(dashboardRevisions.id));
  }

  /** Insert a snapshot of `dashboard` as a revision. Runs inside the write transaction. */
  private async snapshot(tx: Tx, dashboard: DashboardRecord, writer: string | null, chatContext: unknown) {
    const [latest] = await tx
      .select({ createdAt: dashboardRevisions.createdAt })
      .from(dashboardRevisions)
      .where(eq(dashboardRevisions.dashboardId, dashboard.id))
      .orderBy(desc(dashboardRevisions.createdAt), desc(dashboardRevisions.id))
      .limit(1);
    await tx.insert(dashboardRevisions).values({
      id: `dashboard-revision-${randomUUID()}`,
      dashboardId: dashboard.id,
      kind: dashboard.kind,
      title: dashboard.title,
      config: JSON.stringify(dashboard.config),
      ownerEmail: dashboard.ownerEmail,
      createdAt: nextRevisionTimestamp(latest?.createdAt),
      createdBy: writer,
      chatContext: chatContext == null ? null : JSON.stringify(chatContext),
    });
  }

  private recordFromRow(row: typeof dashboards.$inferSelect): DashboardRecord {
    return {
      id: row.id,
      kind: row.kind as "health",
      title: row.title,
      config: JSON.parse(row.config) as DashboardConfig,
      ownerEmail: row.ownerEmail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null,
      archivedAt: row.archivedAt ?? null,
    };
  }

  private revisionFromRow(row: typeof dashboardRevisions.$inferSelect): DashboardRevision {
    return {
      id: row.id,
      dashboardId: row.dashboardId,
      kind: row.kind as "health",
      title: row.title,
      config: JSON.parse(row.config) as DashboardConfig,
      ownerEmail: row.ownerEmail,
      createdAt: row.createdAt,
      createdBy: row.createdBy ?? null,
      chatContext: row.chatContext == null ? null : JSON.parse(row.chatContext),
    };
  }
}
