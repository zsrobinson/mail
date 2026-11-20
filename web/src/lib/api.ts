import { parseJson } from "@zsrobinson/shell/lib/api"
export { ApiError, errorMessage, getJson } from "@zsrobinson/shell/lib/api"

export async function sendJson<T>(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return parseJson<T>(response)
}
