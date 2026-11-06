import { Test } from "@nestjs/testing";
import { HealthController } from "./health.controller";

test("healthz returns ok", async () => {
  const mod = await Test.createTestingModule({ controllers: [HealthController] }).compile();
  expect(mod.get(HealthController).healthz()).toEqual({ ok: true });
});
