/** Input rules shared by the forms and the server proxy. */
import type { AllowlistInput } from "./types.ts"

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
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

/** A date input value (YYYY-MM-DD) becomes the end of that UTC day. */
export function expiryFromDate(date: string) {
  if (!date) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const time = Date.parse(`${date}T23:59:59Z`)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

export function dateFromExpiry(iso: string | null) {
  return iso ? iso.slice(0, 10) : ""
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
