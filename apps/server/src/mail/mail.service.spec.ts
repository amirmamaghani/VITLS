import nodemailer from "nodemailer";
import { afterEach, expect, test, vi } from "vitest";

import { MailService } from "./mail.service";

const MESSAGE = { to: "a@b.co", subject: "Hi", html: "<p>http://link</p>" };

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
});

test("PROD: posts to Resend with bearer auth and the message body", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "VITLS <hi@vitls.app>";
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

  await new MailService().send(MESSAGE);

  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("https://api.resend.com/emails");
  expect((init!.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
  expect(JSON.parse(init!.body as string)).toEqual({ from: "VITLS <hi@vitls.app>", ...MESSAGE });
});

test("PROD: throws on a non-ok Resend response", async () => {
  process.env.RESEND_API_KEY = "re_test_key";
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 422 }));
  await expect(new MailService().send(MESSAGE)).rejects.toThrow(/Resend send failed: 422/);
});

test("DEV: relays over SMTP to the local sink when no API key is set", async () => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: "1" });
  const createTransport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail } as never);

  await new MailService().send(MESSAGE);

  expect(createTransport).toHaveBeenCalledWith({ host: "127.0.0.1", port: 1027, secure: false });
  expect(sendMail).toHaveBeenCalledWith({ from: "VITLS <noreply@vitls.app>", ...MESSAGE });
});
