import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/**
 * Maps thrown errors to the frozen device-API JSON shape (ported from `deviceRoute` in
 * apps/app/server/lib/ingest/http.ts): services throw `HttpException({ error, errorCode }, status)`
 * and it reaches the client as exactly that JSON at that status.
 */
const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ZodError) {
      return res.status(400).json({
        error: "Invalid payload",
        errorCode: "invalid_payload",
        issues: exception.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (exception instanceof SyntaxError) {
      // Malformed JSON body from the parser.
      return res.status(400).json({ error: "Invalid payload", errorCode: "invalid_payload" });
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      if (typeof body === "object" && body && "errorCode" in body) return res.status(status).json(body);
      // Nest built-ins ({message, error, statusCode} or a bare string) -> the {error, errorCode} contract.
      const msg = typeof body === "string" ? body : (body as { message?: string | string[] }).message;
      const error = Array.isArray(msg) ? msg.join("; ") : (msg ?? exception.message);
      return res.status(status).json({ error, errorCode: STATUS_CODES[status] ?? "error" });
    }
    // Log only the error class: parser/DB messages can echo request data (PHI, codes).
    console.error("[server] unexpected error", (exception as Error)?.name);
    return res.status(500).json({ error: "Internal server error", errorCode: "internal" });
  }
}
