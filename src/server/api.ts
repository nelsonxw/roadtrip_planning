import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/errors";
import { requireUser } from "./auth";

type Params = Promise<Record<string, string>>;
type Context = { params: Params };

/** Wraps a route handler: requires a session, converts errors to JSON, and passes resolved route params. */
export function authedRoute<P extends Record<string, string> = Record<string, never>>(
  handler: (request: Request, user: { id: string; email: string }, params: P) => Promise<Response>,
) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      const user = await requireUser();
      return await handler(request, user, await context.params);
    } catch (error) {
      const { status, body } = toErrorResponse(error);
      return NextResponse.json(body, { status });
    }
  };
}

export function publicRoute(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      const { status, body } = toErrorResponse(error);
      return NextResponse.json(body, { status });
    }
  };
}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new AppError(400, "invalid_json", "The request body must be JSON.");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AppError(422, "validation_failed", result.error.issues[0]?.message ?? "Invalid request.", result.error.issues);
  }
  return result.data;
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export type RouteContext = Context;
