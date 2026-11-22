import assert from "node:assert/strict"
import { test } from "node:test"
import {
  addressError,
  expiryError,
  dateFromExpiry,
  expiryFromDate,
  noteError,
  parseActivityQuery,
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

test("expiry dates end that local day and must be in the future", () => {
  assert.equal(expiryFromDate(""), null)
  const end = new Date(expiryFromDate("2027-01-02")!)
  assert.deepEqual(
    [end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()],
    [2027, 0, 2, 23]
  )
  assert.equal(dateFromExpiry(end.toISOString()), "2027-01-02")
  assert.equal(expiryFromDate("tomorrow"), undefined)
  assert.equal(expiryFromDate("2027-02-30"), undefined)
  const now = Date.parse("2026-11-20T12:00:00Z")
  assert.equal(expiryError(expiryFromDate("2026-11-21"), now), null)
  assert.notEqual(expiryError(expiryFromDate("2026-11-19"), now), null)
  assert.notEqual(expiryError(undefined, now), null)
})

test("activity queries are rebuilt from checked values only", () => {
  const ok = parseActivityQuery(
    new URLSearchParams(
      "q=%20archive%20&tool=archive_messages,move_messages,archive_messages&outcome=refused&refusals=1&offset=50&limit=50&tz=America/New_York&from=2026-11-01T04:00:00Z&extra=1"
    )
  )
  assert.ok(ok.ok)
  assert.equal(
    ok.value.toString(),
    "q=archive&from=2026-11-01T04%3A00%3A00.000Z&tool=archive_messages%2Cmove_messages&outcome=refused&refusals=1&offset=50&limit=50&tz=America%2FNew_York"
  )
  for (const bad of [
    "tool=send_message",
    "outcome=great",
    "limit=500",
    "limit=0",
    "offset=-1",
    "from=yesterday",
    "tz=../../etc",
    "refusals=yes",
    `q=${"x".repeat(201)}`,
  ])
    assert.equal(parseActivityQuery(new URLSearchParams(bad)).ok, false, bad)
})
