import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { dataShares } from "../db/schema";

@Injectable()
export class SharesService {
  constructor(private readonly dbs: DbService) {}

  async grant(ownerEmail: string, granteeEmail: string, role = "read"): Promise<void> {
    if (ownerEmail === granteeEmail) throw new BadRequestException("Cannot share with yourself");
    if (role !== "read") throw new BadRequestException("Unsupported role");
    const set = { role, createdAt: new Date().toISOString(), revokedAt: null };
    await this.dbs.db
      .insert(dataShares)
      .values({ ownerEmail, granteeEmail, ...set })
      .onConflictDoUpdate({ target: [dataShares.ownerEmail, dataShares.granteeEmail], set });
  }

  async revoke(ownerEmail: string, granteeEmail: string): Promise<void> {
    await this.dbs.db
      .update(dataShares)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(dataShares.ownerEmail, ownerEmail), eq(dataShares.granteeEmail, granteeEmail)));
  }

  listGrantsByOwner(ownerEmail: string) {
    return this.dbs.db
      .select({ granteeEmail: dataShares.granteeEmail, role: dataShares.role, createdAt: dataShares.createdAt, revokedAt: dataShares.revokedAt })
      .from(dataShares)
      .where(eq(dataShares.ownerEmail, ownerEmail));
  }

  listGrantsToGrantee(granteeEmail: string) {
    return this.dbs.db
      .select({ ownerEmail: dataShares.ownerEmail, role: dataShares.role, createdAt: dataShares.createdAt })
      .from(dataShares)
      .where(and(eq(dataShares.granteeEmail, granteeEmail), isNull(dataShares.revokedAt)));
  }

  async hasReadGrant(ownerEmail: string, granteeEmail: string): Promise<boolean> {
    const rows = await this.dbs.db
      .select({ role: dataShares.role })
      .from(dataShares)
      .where(and(eq(dataShares.ownerEmail, ownerEmail), eq(dataShares.granteeEmail, granteeEmail), eq(dataShares.role, "read"), isNull(dataShares.revokedAt)))
      .limit(1);
    return rows.length > 0;
  }

  /** Whose data a READ should return. Writes must always use the session user, never this. */
  async resolveReadOwner(sessionUser: string, rawOwner?: string): Promise<string> {
    const requestedOwner = rawOwner?.trim().toLowerCase();
    if (!requestedOwner || requestedOwner === sessionUser) return sessionUser;
    if (await this.hasReadGrant(requestedOwner, sessionUser)) return requestedOwner;
    throw new ForbiddenException("Not allowed to read this owner's data");
  }
}
