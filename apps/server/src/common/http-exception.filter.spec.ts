import { type ArgumentsHost, ConflictException, HttpException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { HttpExceptionFilter } from "./http-exception.filter";

function run(exception: unknown) {
  const out: { status?: number; body?: unknown } = {};
  const res = {
    status(s: number) {
      out.status = s;
      return this;
    },
    json(b: unknown) {
      out.body = b;
      return this;
    },
  };
  new HttpExceptionFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost);
  return out;
}

describe("HttpExceptionFilter", () => {
  it("remaps Nest built-ins to {error, errorCode}", () => {
    expect(run(new NotFoundException("x"))).toEqual({ status: 404, body: { error: "x", errorCode: "not_found" } });
    expect(run(new ConflictException("y"))).toEqual({ status: 409, body: { error: "y", errorCode: "conflict" } });
  });
  it("remaps bare string bodies and unknown statuses", () => {
    expect(run(new HttpException("teapot", 418))).toEqual({ status: 418, body: { error: "teapot", errorCode: "error" } });
  });
  it("joins array messages", () => {
    expect(run(new HttpException({ message: ["a", "b"], error: "Bad Request", statusCode: 400 }, 400)).body).toEqual({
      error: "a; b",
      errorCode: "bad_request",
    });
  });
  it("passes an existing errorCode through unchanged", () => {
    const body = { error: "z", errorCode: "custom" };
    expect(run(new HttpException(body, 400))).toEqual({ status: 400, body });
  });
});
