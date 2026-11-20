import assert from "node:assert/strict"
import { test } from "node:test"
import {
  addressError,
  expiryError,
  expiryFromDate,
  noteError,
} from "../src/lib/validation.ts"

test("addresses must be one exact ASCII address", () => {
  for (const ok of ["a@example.org", "first.last+tag@mail.example.net"])
    assert.equal(addressError(ok), null, ok)
  for (const bad of [
    "",
    "@example.org",
    "example.org",
    "a@localhost",
    "a..b@example.org",
    ".a@example.org",
    "a.@example.org",
    "a@example..org",
    "a@-example.org",
    "a b@example.org",
    "ünï@example.org",
    `${"a".repeat(65)}@example.org`,
  ])
    assert.notEqual(addressError(bad), null, bad)
})

test("notes are limited to 1000 characters", () => {
  assert.equal(noteError("x".repeat(1000)), null)
  assert.notEqual(noteError("x".repeat(1001)), null)
})

test("expiry dates end that UTC day and must be in the future", () => {
  assert.equal(expiryFromDate(""), null)
  assert.equal(expiryFromDate("2027-01-02"), "2027-01-02T23:59:59.000Z")
  assert.equal(expiryFromDate("tomorrow"), undefined)
  const now = Date.parse("2026-11-20T12:00:00Z")
  assert.equal(expiryError(expiryFromDate("2026-11-21"), now), null)
  assert.notEqual(expiryError(expiryFromDate("2026-11-19"), now), null)
  assert.notEqual(expiryError(undefined, now), null)
})
