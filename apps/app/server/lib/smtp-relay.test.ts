import { describe, expect, it, vi } from "vitest";

import {
  RESEND_EMAILS_URL,
  createSmtpRelayFetch,
  resendPayloadToMail,
} from "./smtp-relay.js";

describe("resendPayloadToMail", () => {
  it("maps the framework's Resend payload onto nodemailer options", () => {
    const mail = resendPayloadToMail({
      from: "Getmedoc <no-reply@example.com>",
      to: "person@example.com",
      cc: ["copy@example.com"],
      reply_to: "reply@example.com",
      subject: "Sign in",
      html: "<p>hi</p>",
      text: "hi",
      headers: { "In-Reply-To": "<abc@example.com>" },
      attachments: [
        {
          filename: "logo.png",
          content: Buffer.from("png-bytes").toString("base64"),
          content_type: "image/png",
          content_id: "logo",
        },
      ],
    });

    expect(mail).toEqual({
      from: "Getmedoc <no-reply@example.com>",
      to: "person@example.com",
      cc: ["copy@example.com"],
      replyTo: "reply@example.com",
      subject: "Sign in",
      html: "<p>hi</p>",
      text: "hi",
      headers: { "In-Reply-To": "<abc@example.com>" },
      attachments: [
        {
          filename: "logo.png",
          content: Buffer.from("png-bytes"),
          contentType: "image/png",
          cid: "logo",
          contentDisposition: "inline",
        },
      ],
    });
  });

  it("omits optional fields that are absent", () => {
    const mail = resendPayloadToMail({
      from: "a@example.com",
      to: ["b@example.com"],
      subject: "s",
      html: "<p>x</p>",
    });
    expect(mail).toEqual({
      from: "a@example.com",
      to: ["b@example.com"],
      subject: "s",
      html: "<p>x</p>",
    });
  });
});

describe("createSmtpRelayFetch", () => {
  const payload = {
    from: "a@example.com",
    to: "b@example.com",
    subject: "Magic link",
    html: "<a href='x'>x</a>",
  };

  it("relays Resend API posts over SMTP and answers like Resend", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<m1@local>" });
    const baseFetch = vi.fn();
    const relayFetch = createSmtpRelayFetch(baseFetch, sendMail);

    const res = await relayFetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: { Authorization: "Bearer local" },
      body: JSON.stringify(payload),
    });

    expect(baseFetch).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(resendPayloadToMail(payload));
    expect(res.ok).toBe(true);
    await expect(res.json()).resolves.toEqual({ id: "<m1@local>" });
  });

  it("passes every other request through untouched", async () => {
    const sendMail = vi.fn();
    const expected = new Response("ok");
    const baseFetch = vi.fn().mockResolvedValue(expected);
    const relayFetch = createSmtpRelayFetch(baseFetch, sendMail);

    const res = await relayFetch("https://api.example.com/other", {
      method: "POST",
      body: "{}",
    });

    expect(res).toBe(expected);
    expect(sendMail).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it("accepts a Request object as input", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<m2@local>" });
    const relayFetch = createSmtpRelayFetch(vi.fn(), sendMail);

    const res = await relayFetch(
      new Request(RESEND_EMAILS_URL, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );

    expect(res.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("reports SMTP failures as a non-ok provider response", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("ECONNREFUSED 1025"));
    const relayFetch = createSmtpRelayFetch(vi.fn(), sendMail);

    const res = await relayFetch(RESEND_EMAILS_URL, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toContain("ECONNREFUSED 1025");
  });
});
