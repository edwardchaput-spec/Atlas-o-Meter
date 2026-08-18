import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AppError } from "@/lib/errors";
import type { ApiErrorPayload } from "@/lib/types";

export async function parseJsonBody(
  request: Request,
  maxBytes = 16_384,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "That request is too large.");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "That request is too large.");
  }
  return JSON.parse(body) as unknown;
}

export function jsonError(error: unknown): NextResponse<ApiErrorPayload> {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (error instanceof ZodError) {
    const flattened = error.flatten();
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Please check the highlighted information.",
          fields: flattened.fieldErrors,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "The request body is not valid JSON.",
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  console.error("Unhandled API error", error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
      },
    },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
