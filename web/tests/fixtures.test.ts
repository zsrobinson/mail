import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { createFixtures } from "../server/fixtures.ts"
import { createFixtureApp } from "../server/fixture-app.ts"
import { OUTCOMES } from "../src/lib/types.ts"
import type {
  Action,
  Activity,
  Allowlist,
  AllowlistDetail,
  Health,
  Overview,
} from "../src/lib/types.ts"

const NOW = Date.parse("2026-11-20T18:30:00Z")
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function client() {
  const { forward } = createFixtures(() => NOW)
  return async <T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown
  ) => {
    const response = await forward({ method, path, body })
    return response as { status: number; body: T }
  }
}

describe("fixtures", () => {
  test("only synthetic example addresses appear anywhere", async () => {
    const call = client()
    const text = JSON.stringify([
      (await call("GET", "/api/allowlist")).body,
      (await call("GET", "/api/activity")).body,
      (await call("GET", "/api/overview?range=30d")).body,
      (await call("GET", "/api/health")).body,
    ])
    const addresses = text.match(/[\w.+-]+@[\w.-]+/g) ?? []
    assert.ok(addresses.length > 0)
    for (const address of addresses)
      assert.match(address, /@([\w-]+\.)*example\.(org|net|com)$/)
    assert.doesNotMatch(text, /"@/)
  })

  test("overview series are dense and sized by range", async () => {
    const call = client()
    for (const [range, points, seconds] of [
      ["24h", 24, 3600],
      ["7d", 7, 86400],
      ["30d", 30, 86400],
    ] as const) {
      const { body } = await call<Overview>(
        "GET",
        `/api/overview?range=${range}`
      )
      assert.equal(body.calls.length, points)
      assert.equal(body.body_reads.length, points)
      assert.equal(body.bucket_seconds, seconds)
      assert.equal(body.writes_by_kind.length, 6)
      assert.equal(
        body.totals.calls,
        body.calls.reduce((sum, c) => sum + c.ok + c.refused + c.error, 0)
      )
    }
  })

  test("activity uses the outcome vocabulary and filters", async () => {
    const call = client()
    const all = (await call<Activity>("GET", "/api/activity")).body
    assert.ok(all.rows.length > 0 && all.rows.length <= 200)
    for (const row of all.rows) assert.ok(OUTCOMES.includes(row.outcome))
    const refused = (
      await call<Activity>("GET", "/api/activity?tool=&outcome=refused")
    ).body
    assert.ok(refused.rows.every((row) => row.outcome === "refused"))
    const reads = (
      await call<Activity>("GET", "/api/activity?tool=read_messages&outcome=")
    ).body
    assert.ok(reads.rows.every((row) => row.tool === "read_messages"))
  })

  test("allowlist ids are UUIDs, matches span 366 days, history is minimal", async () => {
    const call = client()
    const list = (await call<Allowlist>("GET", "/api/allowlist")).body
    for (const entry of list.entries) {
      assert.match(entry.id, UUID)
      assert.equal(entry.matches.length, 366)
    }
    for (const item of list.history)
      assert.deepEqual(Object.keys(item).sort(), ["change", "time"])
    const detail = (
      await call<AllowlistDetail>("GET", `/api/allowlist/${list.entries[0].id}`)
    ).body
    for (const item of detail.history)
      assert.deepEqual(Object.keys(item).sort(), ["change", "time"])
  })

  test("allowlist edits are recorded and duplicates refused", async () => {
    const call = client()
    const added = await call<{ entry: { id: string } }>(
      "POST",
      "/api/allowlist",
      {
        address: "new@example.org",
        note: "",
        expires_at: null,
      }
    )
    assert.equal(added.status, 201)
    const duplicate = await call("POST", "/api/allowlist", {
      address: "new@example.org",
      note: "",
      expires_at: null,
    })
    assert.equal(duplicate.status, 409)
    const path = `/api/allowlist/${added.body.entry.id}`
    await call("PATCH", path, { note: "Changed" })
    const detail = (await call<AllowlistDetail>("GET", path)).body
    assert.deepEqual(detail.history.map((h) => h.change).sort(), [
      "added",
      "note_changed",
    ])
    assert.equal((await call("DELETE", path)).status, 200)
    assert.equal((await call("GET", path)).status, 404)
  })

  test("unarchive needs a fresh preview token that works once", async () => {
    const call = client()
    const activity = (
      await call<Activity>("GET", "/api/activity?tool=archive_messages")
    ).body
    let target: Action | undefined
    for (const row of activity.rows) {
      const action = (
        await call<Action>("GET", `/api/actions/${row.action_id}`)
      ).body
      if (action.unarchive?.eligible) {
        target = action
        break
      }
    }
    assert.ok(target, "an eligible archive action exists")
    const url = `/api/actions/${target.id}/unarchive`
    assert.equal(
      (await call("POST", url, { dry_run: false, preview_token: "made-up" }))
        .status,
      409
    )
    const preview = await call<{ preview_token: string; messages: number }>(
      "POST",
      url,
      { dry_run: true }
    )
    assert.equal(preview.status, 200)
    assert.equal(preview.body.messages, target.counts.completed)
    const done = await call<{ action_id: string }>("POST", url, {
      dry_run: false,
      preview_token: preview.body.preview_token,
    })
    assert.equal(done.status, 200)
    assert.match(done.body.action_id, UUID)
    assert.equal(
      (
        await call("POST", url, {
          dry_run: false,
          preview_token: preview.body.preview_token,
        })
      ).status,
      409
    )
    const after = (await call<Action>("GET", `/api/actions/${target.id}`)).body
    assert.equal(after.unarchive?.restored_by, done.body.action_id)
  })

  test("health reports percentiles and failures by class", async () => {
    const call = client()
    const { body } = await call<Health>("GET", "/api/health")
    const bridge = body.components.find((c) => c.id === "bridge")!
    assert.ok(bridge.p50_ms !== null && bridge.p95_ms !== null)
    assert.ok(bridge.p95_ms >= bridge.p50_ms)
    assert.ok(bridge.failures.length > 0)
  })

  test("the fixture app rejects cross-origin writes", async () => {
    const app = createFixtureApp(() => NOW)
    const response = await app.request("/api/allowlist", {
      method: "POST",
      headers: {
        Origin: "https://elsewhere.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: "a@example.org",
        note: "",
        expires_at: null,
      }),
    })
    assert.equal(response.status, 403)
    assert.equal((await app.request("/api/session")).status, 200)
  })
})
