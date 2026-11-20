import { request } from "node:http"
import type { CoreRequest, CoreResponse, Forward } from "./routes.ts"

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/**
 * Forwards one validated request to the core API over its Unix socket. Only
 * the Access assertion and JSON content headers are sent; browser cookies and
 * other headers never reach the core.
 */
export function socketForward(socketPath: string): Forward {
  return (input: CoreRequest) =>
    new Promise<CoreResponse>((resolve, reject) => {
      const payload =
        input.body === undefined ? undefined : JSON.stringify(input.body)
      const headers: Record<string, string> = { Accept: "application/json" }
      if (input.assertion) headers["Cf-Access-Jwt-Assertion"] = input.assertion
      if (payload !== undefined) {
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = String(Buffer.byteLength(payload))
      }
      const call = request(
        {
          socketPath,
          path: input.path,
          method: input.method,
          headers,
          timeout: input.timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = []
          let size = 0
          response.on("data", (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_RESPONSE_BYTES) {
              response.destroy()
              reject(new Error("Core response too large"))
              return
            }
            chunks.push(chunk)
          })
          response.on("error", reject)
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8")
            let body: unknown
            try {
              body = text ? JSON.parse(text) : null
            } catch {
              // Non-JSON answers are treated as errors by relay().
              body = null
            }
            resolve({ status: response.statusCode ?? 502, body })
          })
        }
      )
      call.on("timeout", () => call.destroy(new Error("Core timed out")))
      call.on("error", reject)
      call.end(payload)
    })
}
