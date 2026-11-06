import type { ExecutionContext } from "@nestjs/common";
import { DeviceGuard } from "./device.guard";

const ident = (scope: string) => ({ deviceId: "d", userEmail: "a@b.co", scope });

function setup(auth: { scope: string } | null, allowed = true) {
  const devices: any = { authenticateDeviceToken: async () => (auth ? ident(auth.scope) : null) };
  const rate: any = { hitRateLimit: async () => allowed };
  const guard = new DeviceGuard(devices, rate);
  const run = (req: any) => guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as ExecutionContext);
  return run;
}
const bearer = { headers: { authorization: "Bearer vdt_x" } };

test("rejects missing/malformed header with 401", async () => {
  const run = setup({ scope: "ingest:write" });
  await expect(run({ headers: {} })).rejects.toMatchObject({ status: 401 });
  await expect(run({ headers: { authorization: "Basic abc" } })).rejects.toMatchObject({ status: 401 });
});
test("rejects unknown/revoked token with 401", async () => {
  await expect(setup(null)({ ...bearer })).rejects.toMatchObject({ status: 401 });
});
test("rejects a non-ingest scope with 403", async () => {
  await expect(setup({ scope: "read:only" })({ ...bearer })).rejects.toMatchObject({ status: 403 });
});
test("rejects over-limit with 429", async () => {
  await expect(setup({ scope: "ingest:write" }, false)({ ...bearer })).rejects.toMatchObject({ status: 429 });
});
test("passes a valid ingest token and sets req.device", async () => {
  const req: any = { ...bearer };
  expect(await setup({ scope: "ingest:write" })(req)).toBe(true);
  expect(req.device.userEmail).toBe("a@b.co");
});
