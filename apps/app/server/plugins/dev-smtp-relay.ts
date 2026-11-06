import { defineNitroPlugin } from "@agent-native/core/server";
import { createTransport } from "nodemailer";

import { createSmtpRelayFetch } from "../lib/smtp-relay.js";

/**
 * Development-only SMTP relay so magic-link, verification, and reset emails
 * land in a local sink such as Mailpit (`pnpm mailpit`, inbox at
 * http://localhost:8027 by default).
 *
 * Activation requires both:
 *   - NODE_ENV is not "production"
 *   - MAIL_SMTP_HOST is set (no implicit localhost default)
 *
 * The framework's own transport stays untouched: it still believes it is
 * calling Resend, which is why `.env` also needs a placeholder
 * RESEND_API_KEY so the framework offers the magic-link sign-in mode.
 * Production keeps the framework's native Resend/SendGrid delivery.
 *
 * MAIL_SMTP_* are deployment-level transport settings for a local mail sink,
 * not per-user credentials, hence the guard opt-outs below.
 */
interface SmtpRelayEnv {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  hasResendPlaceholder: boolean;
}

function readSmtpRelayEnv(): SmtpRelayEnv | undefined {
  const host = process.env.MAIL_SMTP_HOST?.trim(); // guard:allow-env-credential — local SMTP sink host, deployment transport setting
  if (!host) return undefined;
  const port = Number(process.env.MAIL_SMTP_PORT ?? 1025); // guard:allow-env-credential — local SMTP sink port, deployment transport setting
  const secure = process.env.MAIL_SMTP_SECURE === "true"; // guard:allow-env-credential — local SMTP TLS flag, deployment transport setting
  const user = process.env.MAIL_SMTP_USER?.trim() || undefined; // guard:allow-env-credential — local SMTP relay login, deployment transport setting
  const pass = process.env.MAIL_SMTP_PASS; // guard:allow-env-credential — local SMTP relay password, deployment transport setting
  const hasResendPlaceholder = Boolean(process.env.RESEND_API_KEY); // guard:allow-env-credential — presence check only, mirrors the framework's own deploy-level read
  return { host, port, secure, user, pass, hasResendPlaceholder };
}

export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV === "production") return;

  const env = readSmtpRelayEnv();
  if (!env) return;

  const transport = createTransport({
    host: env.host,
    port: env.port,
    secure: env.secure,
    auth: env.user ? { user: env.user, pass: env.pass ?? "" } : undefined,
  });

  const baseFetch = globalThis.fetch;
  globalThis.fetch = createSmtpRelayFetch(baseFetch, (mail) =>
    transport.sendMail(mail),
  );

  if (!env.hasResendPlaceholder) {
    console.warn(
      "[dev-smtp-relay] MAIL_SMTP_HOST is set but RESEND_API_KEY is empty. " +
        "Set RESEND_API_KEY to any placeholder so the framework enables " +
        "magic-link sign-in; the relay delivers it over SMTP.",
    );
  }
  console.log(
    `[dev-smtp-relay] relaying transactional email over SMTP to ${env.host}:${env.port}`,
  );
});
