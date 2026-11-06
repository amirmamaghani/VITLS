import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { SharesService } from "./shares.service";

const email = z.string().trim().toLowerCase().email();
const grantBody = z.object({ grantee: email, role: z.literal("read").optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

@Controller("api/shares")
@UseGuards(AuthGuard)
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Post()
  async grant(@CurrentUser() sessionUser: string, @Body() body: unknown) {
    const { grantee, role } = parse(grantBody, body);
    await this.shares.grant(sessionUser, grantee, role ?? "read");
    return { message: "Shared." };
  }

  @Get()
  async list(@CurrentUser() sessionUser: string) {
    return { granted: await this.shares.listGrantsByOwner(sessionUser), sharedWithMe: await this.shares.listGrantsToGrantee(sessionUser) };
  }

  @Delete(":grantee")
  async revoke(@CurrentUser() sessionUser: string, @Param("grantee") grantee: string) {
    await this.shares.revoke(sessionUser, grantee.trim().toLowerCase());
    return { message: "Revoked." };
  }
}
