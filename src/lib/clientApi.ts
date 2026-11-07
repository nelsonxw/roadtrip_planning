/** Thin fetch wrapper for browser code. Throws an Error whose message is safe to show the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error ?? "Something went wrong. Please try again.", response.status, data.code ?? "error");
  return data as T;
}

export const post = <T>(url: string, body: unknown) => api<T>(url, { method: "POST", body: JSON.stringify(body) });
export const patch = <T>(url: string, body: unknown) => api<T>(url, { method: "PATCH", body: JSON.stringify(body) });
