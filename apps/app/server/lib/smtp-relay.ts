/**
 * Local SMTP relay for the framework's transactional email.
 *
 * `@agent-native/core` only speaks Resend and SendGrid, and magic-link sign-in
 * is offered only when one of those keys is present. In development we keep
 * the framework's Resend path exactly as-is and answer its HTTPS call locally:
 * the Resend JSON payload is mapped onto nodemailer and relayed over SMTP to a
 * sink such as Mailpit. Everything in this module is pure so it can be unit
 * tested; the Nitro plugin in `server/plugins/dev-smtp-relay.ts` wires it in.
 */

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/** The subset of Resend's `POST /emails` body that the framework sends. */
export interface ResendEmailPayload {
  from: string;
  to: string | string[];
  cc?: string | string[];
  reply_to?: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    /** Base64-encoded bytes. */
    content: string;
    content_type?: string;
    content_id?: string;
  }>;
}

/** Structural type matching `nodemailer`'s `Mail.Options` for what we set. */
export interface RelayMailOptions {
  from: string;
  to: string | string[];
  cc?: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
    cid?: string;
    contentDisposition?: "inline" | "attachment";
  }>;
}

export type RelaySendMail = (
  mail: RelayMailOptions,
) => Promise<{ messageId?: string }>;

export function resendPayloadToMail(
  payload: ResendEmailPayload,
): RelayMailOptions {
  const mail: RelayMailOptions = {
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  };
  if (payload.cc !== undefined) mail.cc = payload.cc;
  if (payload.reply_to !== undefined) mail.replyTo = payload.reply_to;
  if (payload.text !== undefined) mail.text = payload.text;
  if (payload.headers !== undefined) mail.headers = payload.headers;
  if (payload.attachments?.length) {
    mail.attachments = payload.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.content, "base64"),
      ...(attachment.content_type
        ? { contentType: attachment.content_type }
        : {}),
      ...(attachment.content_id
        ? { cid: attachment.content_id, contentDisposition: "inline" as const }
        : {}),
    }));
  }
  return mail;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

async function requestBodyText(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string> {
  if (init?.body !== undefined && init.body !== null) {
    if (typeof init.body === "string") return init.body;
    return new Response(init.body).text();
  }
  if (input instanceof Request) return input.clone().text();
  return "";
}

/**
 * Wrap `fetch` so the framework's Resend call is delivered over SMTP instead.
 * Every other request goes straight to `baseFetch`. The response mimics
 * Resend's shape (`{ id }`), so the framework's send log records success, and
 * an SMTP failure surfaces as a non-ok provider response the framework
 * already knows how to report.
 */
export function createSmtpRelayFetch(
  baseFetch: typeof fetch,
  sendMail: RelaySendMail,
): typeof fetch {
  const relayFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (
      requestUrl(input) !== RESEND_EMAILS_URL ||
      requestMethod(input, init) !== "POST"
    ) {
      return baseFetch(input, init);
    }

    try {
      const payload = JSON.parse(
        await requestBodyText(input, init),
      ) as ResendEmailPayload;
      const info = await sendMail(resendPayloadToMail(payload));
      return Response.json({ id: info.messageId ?? "smtp-relay" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json(
        { name: "smtp_relay_error", message: `SMTP relay failed: ${message}` },
        { status: 502 },
      );
    }
  };
  return relayFetch as typeof fetch;
}
