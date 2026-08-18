import type { ApiErrorPayload } from "@/lib/types";

export class ClientApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let payload: ApiErrorPayload | null = null;
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      // Fall through to the generic message below.
    }
    throw new ClientApiError(
      payload?.error.message ?? "Atlas-o-meter could not save that change.",
      response.status,
      payload?.error.code ?? "REQUEST_FAILED",
    );
  }

  return (await response.json()) as T;
}
