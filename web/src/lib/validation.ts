/** Input rules shared by the forms and the server proxy. */
import type { AllowlistInput } from "./types.ts"
import { OUTCOMES, TOOLS } from "./types.ts"
import {
  endOfCalendarDay,
  isCalendarDate,
  toCalendarDate,
} from "@zsrobinson/shell/lib/calendar-date"

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const CALL_ID_PATTERN = /^[a-f0-9]{32}$/
/** IANA zone names such as America/New_York; the core falls back to UTC. */
export const ZONE_PATTERN =
  /^[A-Za-z0-9_+-]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){0,2}$/
export const SEARCH_MAX = 200
export const PAGE_MAX = 200
export const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{1,512}$/
export const NOTE_MAX = 1000
export const ADDRESS_MAX = 254

// One exact ASCII address. Deliberately conservative: no domain-wide entries,
// display names, comments, quoted local parts or whitespace.
const ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/

export function normalizeAddress(value: string) {
  return value.trim().toLowerCase()
}

export function addressError(value: string) {
  const address = normalizeAddress(value)
  if (!address) return "Enter an address"
  if (address.length > ADDRESS_MAX) return "Address is too long"
  if (
    !ADDRESS.test(address) ||
    address.includes("..") ||
    address.startsWith(".") ||
    address.includes(".@")
  )
    return "Enter one full address, like name@example.org"
  return null
}

export function noteError(value: string) {
  return value.trim().length > NOTE_MAX
    ? `Keep the note under ${NOTE_MAX} characters`
    : null
}

/**
 * A picked calendar date (YYYY-MM-DD) becomes the end of that day in the
 * viewer's own time zone, as an ISO instant.
 */
export function expiryFromDate(date: string) {
  if (!date) return null
  if (!isCalendarDate(date)) return undefined
  return endOfCalendarDay(date)
}

/** The viewer's calendar day an expiry falls on. */
export function dateFromExpiry(iso: string | null) {
  if (!iso) return ""
  const time = Date.parse(iso)
  return Number.isNaN(time) ? "" : toCalendarDate(new Date(time))
}

export function expiryError(iso: string | null | undefined, now = Date.now()) {
  if (iso === undefined) return "Enter a valid date"
  if (iso !== null && Date.parse(iso) <= now) return "Choose a date after today"
  return null
}

function isIsoTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Accepts only the documented allowlist fields; unknown keys are dropped so
 * nothing the browser invents reaches the core.
 */
export function parseAllowlistBody(
  body: unknown,
  partial: boolean
): Parsed<Partial<AllowlistInput>> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false, error: "Expected a JSON object" }
  const input = body as Record<string, unknown>
  const value: Partial<AllowlistInput> = {}
  if ("address" in input || !partial) {
    if (typeof input.address !== "string")
      return { ok: false, error: "address must be a string" }
    const error = addressError(input.address)
    if (error) return { ok: false, error }
    value.address = normalizeAddress(input.address)
  }
  if ("note" in input || !partial) {
    if (typeof input.note !== "string")
      return { ok: false, error: "note must be a string" }
    const error = noteError(input.note)
    if (error) return { ok: false, error }
    value.note = input.note.trim()
  }
  if ("expires_at" in input || !partial) {
    if (input.expires_at !== null && !isIsoTime(input.expires_at))
      return { ok: false, error: "expires_at must be a time or null" }
    value.expires_at = input.expires_at
  }
  if (partial && Object.keys(value).length === 0)
    return { ok: false, error: "Nothing to change" }
  return { ok: true, value }
}

export type UnarchiveBody =
  { dry_run: true } | { dry_run: false; preview_token: string }

export function parseUnarchiveBody(body: unknown): Parsed<UnarchiveBody> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false, error: "Expected a JSON object" }
  const input = body as Record<string, unknown>
  if (input.dry_run === true) return { ok: true, value: { dry_run: true } }
  if (
    input.dry_run === false &&
    typeof input.preview_token === "string" &&
    TOKEN_PATTERN.test(input.preview_token)
  )
    return {
      ok: true,
      value: { dry_run: false, preview_token: input.preview_token },
    }
  return { ok: false, error: "Preview the unarchive before confirming it" }
}

/**
 * The activity query the browser may send, rebuilt from checked values only:
 * the core never sees a parameter the web server did not validate.
 */
export function parseActivityQuery(
  input: URLSearchParams
): Parsed<URLSearchParams> {
  const out = new URLSearchParams()
  const q = input.get("q") ?? ""
  if (q.length > SEARCH_MAX) return { ok: false, error: "Search is too long" }
  if (q.trim()) out.set("q", q.trim())
  for (const key of ["from", "to"] as const) {
    const value = input.get(key)
    if (!value) continue
    if (!isIsoTime(value)) return { ok: false, error: `${key} must be a time` }
    out.set(key, new Date(value).toISOString())
  }
  const tools = (input.get("tool") ?? "").split(",").filter(Boolean)
  if (tools.some((t) => t !== "unknown" && !TOOLS.includes(t as never)))
    return { ok: false, error: "Unknown tool" }
  if (tools.length) out.set("tool", [...new Set(tools)].join(","))
  const outcomes = (input.get("outcome") ?? "").split(",").filter(Boolean)
  if (outcomes.some((o) => !OUTCOMES.includes(o as never)))
    return { ok: false, error: "Unknown outcome" }
  if (outcomes.length) out.set("outcome", [...new Set(outcomes)].join(","))
  const refusals = input.get("refusals")
  if (refusals && refusals !== "1")
    return { ok: false, error: "refusals must be 1" }
  if (refusals) out.set("refusals", "1")
  for (const [key, max] of [
    ["offset", 1_000_000],
    ["limit", PAGE_MAX],
  ] as const) {
    const value = input.get(key)
    if (value === null || value === "") continue
    if (!/^\d{1,7}$/.test(value) || Number(value) > max)
      return { ok: false, error: `${key} is out of range` }
    if (key === "limit" && Number(value) < 1)
      return { ok: false, error: "limit is out of range" }
    out.set(key, String(Number(value)))
  }
  const tz = input.get("tz")
  if (tz) {
    if (!ZONE_PATTERN.test(tz)) return { ok: false, error: "Unknown time zone" }
    out.set("tz", tz)
  }
  return { ok: true, value: out }
}
