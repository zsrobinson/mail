import type { Context, Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { OUTCOMES, RANGES, TOOLS } from "../src/lib/types.ts"
import {
  ID_PATTERN,
  parseAllowlistBody,
  parseUnarchiveBody,
} from "../src/lib/validation.ts"

export type CoreMethod = "GET" | "POST" | "PATCH" | "DELETE"
export type CoreRequest = {
  method: CoreMethod
  /** Path and query, rebuilt from validated values only. */
  path: string
  body?: unknown
  /** Cloudflare Access assertion, forwarded so the core verifies it again. */
  assertion?: string
  /** Writes wait for the core's own deadline; reads fail fast. */
  timeoutMs?: number
}
export type CoreResponse = { status: number; body: unknown }
export type Forward = (request: CoreRequest) => Promise<CoreResponse>

const READ_TIMEOUT_MS = 15_000
// The core's write deadline is 120 s; allow it to answer before giving up.
const WRITE_TIMEOUT_MS = 150_000
const MAX_ERROR_LENGTH = 300

const tools = new Set<string>(TOOLS)
const outcomes = new Set<string>(OUTCOMES)
const ranges = new Set<string>(RANGES)

const bad = (c: Context, error: string) => c.json({ error }, 400)

/**
 * Translates the core's answer for the browser. Successful bodies pass
 * through; a short 4xx message is kept so refusals read clearly; anything else
 * becomes a generic error so internal detail never reaches the page.
 */
export function relay(c: Context, response: CoreResponse) {
  const { status, body } = response
  if (status >= 200 && status < 300)
    return status === 204 ? c.json({}) : c.json(body as object, status as 200)
  if (status >= 400 && status < 500) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string" &&
      body.error.length <= MAX_ERROR_LENGTH
        ? body.error
        : "Request refused"
    return c.json({ error: message }, status as 400)
  }
  return c.json({ error: "Mail core error" }, 502)
}

async function readJson(c: Context) {
  try {
    return { ok: true as const, value: await c.req.json() }
  } catch {
    return { ok: false as const }
  }
}

/**
 * Registers the fixed browser-facing routes. Every parameter is validated
 * here and the core path is rebuilt, so the browser can never choose an
 * arbitrary core URL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerMailRoutes(app: Hono<any>, forward: Forward) {
  const send = async (c: Context, request: Omit<CoreRequest, "assertion">) => {
    try {
      const response = await forward({
        timeoutMs: READ_TIMEOUT_MS,
        ...request,
        assertion: c.req.header("Cf-Access-Jwt-Assertion") || undefined,
      })
      return relay(c, response)
    } catch {
      return c.json({ error: "Mail core unavailable" }, 503)
    }
  }
  const limit = bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  })

  app.get("/api/overview", (c) => {
    const range = c.req.query("range") || "7d"
    if (!ranges.has(range)) return bad(c, "Unknown range")
    return send(c, { method: "GET", path: `/api/overview?range=${range}` })
  })

  app.get("/api/activity", (c) => {
    const tool = c.req.query("tool") || ""
    const outcome = c.req.query("outcome") || ""
    if (tool && !tools.has(tool) && tool !== "unknown")
      return bad(c, "Unknown tool")
    if (outcome && !outcomes.has(outcome)) return bad(c, "Unknown outcome")
    const query = new URLSearchParams({ tool, outcome })
    return send(c, { method: "GET", path: `/api/activity?${query}` })
  })

  app.get("/api/actions/:id", (c) => {
    const id = c.req.param("id")
    if (!ID_PATTERN.test(id)) return bad(c, "Invalid action id")
    return send(c, { method: "GET", path: `/api/actions/${id}` })
  })

  app.post("/api/actions/:id/unarchive", limit, async (c) => {
    const id = c.req.param("id")
    if (!ID_PATTERN.test(id)) return bad(c, "Invalid action id")
    const json = await readJson(c)
    if (!json.ok) return bad(c, "Expected a JSON object")
    const body = parseUnarchiveBody(json.value)
    if (!body.ok) return bad(c, body.error)
    return send(c, {
      method: "POST",
      path: `/api/actions/${id}/unarchive`,
      body: body.value,
      timeoutMs: body.value.dry_run ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS,
    })
  })

  app.get("/api/allowlist", (c) =>
    send(c, { method: "GET", path: "/api/allowlist" })
  )

  app.post("/api/allowlist", limit, async (c) => {
    const json = await readJson(c)
    if (!json.ok) return bad(c, "Expected a JSON object")
    const body = parseAllowlistBody(json.value, false)
    if (!body.ok) return bad(c, body.error)
    return send(c, { method: "POST", path: "/api/allowlist", body: body.value })
  })

  app.get("/api/allowlist/:id", (c) => {
    const id = c.req.param("id")
    if (!ID_PATTERN.test(id)) return bad(c, "Invalid entry id")
    return send(c, { method: "GET", path: `/api/allowlist/${id}` })
  })

  app.patch("/api/allowlist/:id", limit, async (c) => {
    const id = c.req.param("id")
    if (!ID_PATTERN.test(id)) return bad(c, "Invalid entry id")
    const json = await readJson(c)
    if (!json.ok) return bad(c, "Expected a JSON object")
    const body = parseAllowlistBody(json.value, true)
    if (!body.ok) return bad(c, body.error)
    return send(c, {
      method: "PATCH",
      path: `/api/allowlist/${id}`,
      body: body.value,
    })
  })

  app.delete("/api/allowlist/:id", (c) => {
    const id = c.req.param("id")
    if (!ID_PATTERN.test(id)) return bad(c, "Invalid entry id")
    return send(c, { method: "DELETE", path: `/api/allowlist/${id}` })
  })

  app.get("/api/health", (c) => send(c, { method: "GET", path: "/api/health" }))

  // Anything else under /api is not part of the contract.
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404))
}
