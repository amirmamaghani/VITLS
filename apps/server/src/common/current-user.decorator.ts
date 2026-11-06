import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/** The authenticated owner email attached by AuthGuard. Controllers pass it into services. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ user?: { email: string } }>();
  return req.user!.email;
});
