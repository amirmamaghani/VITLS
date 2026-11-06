import { Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";

import type { Mailer } from "../auth/auth";

/** Resend's `POST /emails` endpoint (payload shape ported from apps/app/server/lib/smtp-relay.ts). */
const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * Transactional email. PROD (RESEND_API_KEY set): POST to Resend. DEV (no key): relay over SMTP
 * to a local sink such as Mailpit (`pnpm mailpit`, SMTP on 127.0.0.1:1027), overridable via
 * MAIL_SMTP_HOST / MAIL_SMTP_PORT.
 */
@Injectable()
export class MailService implements Mailer {
  async send({ to, subject, html }: MailMessage): Promise<void> {
    const from = process.env.MAIL_FROM ?? "VITLS <noreply@vitls.app>";
    const apiKey = process.env.RESEND_API_KEY;

    if (apiKey) {
      const res = await fetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject, html }),
      });
      if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
      return;
    }

    const transport = nodemailer.createTransport({
      host: process.env.MAIL_SMTP_HOST ?? "127.0.0.1",
      port: Number(process.env.MAIL_SMTP_PORT ?? 1027),
      secure: false,
    });
    await transport.sendMail({ from, to, subject, html });
  }
}
