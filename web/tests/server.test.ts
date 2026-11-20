import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type IncomingHttpHeaders } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"
import { Hono } from "hono"
import { createCoreApp, requestLog } from "../server/app.ts"
import { loadCoreConfig, loadFixtureConfig } from "../server/config.ts"
import { socketForward } from "../server/core-socket.ts"
import {
  registerMailRoutes,
  type CoreRequest,
  type CoreResponse,
} from "../server/routes.ts"

function harness(response: CoreResponse | Error = { status: 200, body: {} }) {
  const calls: CoreRequest[] = []
  const app = new Hono()
  registerMailRoutes(app, async (request) => {
    calls.push(request)
    if (response instanceof Error) throw response
    return response
  })
  const send = (path: string, init?: RequestInit) =>
    app.request(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    })
  return { calls, send }
}

const post = (body: unknown, method = "POST") => ({
  method,
  body: JSON.stringify(body),
})

describe("configuration", () => {
  const core = {
    ACCESS_ISSUER: "https://team.example.com",
    ACCESS_AUD: "aud",
    PUBLIC_ORIGIN: "https://mail.example.com",
    SERVICE_MANIFEST: "/dev/null",
    MAIL_CORE_SOCKET: "/run/core.sock",
  }

  test("production requires Access and the core socket", () => {
    assert.equal(loadCoreConfig(core).socket, "/run/core.sock")
    assert.throws(
      () => loadCoreConfig({ ...core, MAIL_CORE_SOCKET: "" }),
      /MAIL_CORE_SOCKET/
    )
    assert.throws(
      () => loadCoreConfig({ ...core, ACCESS_ISSUER: "http://team" }),
      /HTTPS/
    )
    assert.throws(
      () => loadCoreConfig({ ...core, MAIL_FIXTURES: "1" }),
      /dev:fixtures/
    )
  })

  test("fixtures refuse Access, the core socket, production and public binds", () => {
    assert.equal(loadFixtureConfig({ MAIL_FIXTURES: "1" }).port, 8787)
    for (const key of [
      "ACCESS_ISSUER",
      "ACCESS_AUD",
      "PUBLIC_ORIGIN",
      "MAIL_CORE_SOCKET",
    ])
      assert.throws(
        () => loadFixtureConfig({ MAIL_FIXTURES: "1", [key]: "x" }),
        new RegExp(key)
      )
    assert.throws(
      () => loadFixtureConfig({ MAIL_FIXTURES: "1", NODE_ENV: "production" }),
      /production/
    )
    assert.throws(
      () => loadFixtureConfig({ MAIL_FIXTURES: "1", BIND_ADDRESS: "0.0.0.0" }),
      /loopback/
    )
    assert.throws(() => loadFixtureConfig({}), /MAIL_FIXTURES/)
  })
})

describe("routes", () => {
  test("rebuilds core paths from validated values", async () => {
    const { calls, send } = harness()
    assert.equal((await send("/api/overview")).status, 200)
    assert.equal((await send("/api/overview?range=30d")).status, 200)
    assert.equal((await send("/api/overview?range=1y")).status, 400)
    assert.equal(
      (await send("/api/activity?tool=read_messages&outcome=refused&x=1"))
        .status,
      200
    )
    assert.equal((await send("/api/activity?outcome=timeout")).status, 400)
    assert.equal((await send("/api/activity?tool=send_mail")).status, 400)
    assert.equal((await send("/api/actions/..%2Fhealth")).status, 400)
    assert.deepEqual(
      calls.map((c) => c.path),
      [
        "/api/overview?range=7d",
        "/api/overview?range=30d",
        "/api/activity?tool=read_messages&outcome=refused",
      ]
    )
  })

  test("forwards the Access assertion and nothing else from the browser", async () => {
    const { calls, send } = harness()
    await send("/api/health", {
      headers: { "Cf-Access-Jwt-Assertion": "token", Cookie: "a=b" },
    })
    assert.equal(calls[0].assertion, "token")
    assert.deepEqual(Object.keys(calls[0]).sort(), [
      "assertion",
      "method",
      "path",
      "timeoutMs",
    ])
  })

  test("unarchive accepts only a preview or a confirmed preview token", async () => {
    const { calls, send } = harness()
    const url = "/api/actions/6f1c2a9e-3b7d-4c1e-9a52-0d8e4f7b6c31/unarchive"
    assert.equal((await send(url, post({ dry_run: true, x: 1 }))).status, 200)
    assert.equal((await send(url, post({ dry_run: false }))).status, 400)
    assert.equal((await send(url, post({}))).status, 400)
    assert.equal(
      (await send(url, post({ dry_run: false, preview_token: "a b" }))).status,
      400
    )
    assert.equal(
      (await send(url, post({ dry_run: false, preview_token: "pv_1" }))).status,
      200
    )
    assert.deepEqual(
      calls.map((c) => c.body),
      [{ dry_run: true }, { dry_run: false, preview_token: "pv_1" }]
    )
    assert.ok((calls[1].timeoutMs ?? 0) > 120_000)
  })

  test("allowlist writes accept one exact address and drop unknown fields", async () => {
    const { calls, send } = harness({ status: 201, body: { entry: {} } })
    const valid = {
      address: " Updates@Example.org ",
      note: " Notices ",
      expires_at: null,
      admin: true,
    }
    assert.equal((await send("/api/allowlist", post(valid))).status, 201)
    assert.deepEqual(calls[0].body, {
      address: "updates@example.org",
      note: "Notices",
      expires_at: null,
    })
    for (const address of [
      "@example.org",
      "example.org",
      "a@b",
      "two@example.org, three@example.org",
      "Name <a@example.org>",
      "ünï@example.org",
    ])
      assert.equal(
        (await send("/api/allowlist", post({ ...valid, address }))).status,
        400,
        address
      )
    assert.equal(
      (await send("/api/allowlist", post({ ...valid, note: "x".repeat(1001) })))
        .status,
      400
    )
    const id = "/api/allowlist/3c8e1f20-7a4b-4d9e-b6c2-1e5f8a9d0b47"
    assert.equal((await send(id, post({}, "PATCH"))).status, 400)
    assert.equal(
      (await send(id, post({ note: "new", id: "other" }, "PATCH"))).status,
      201
    )
    assert.deepEqual(calls.at(-1)?.body, { note: "new" })
    assert.equal((await send(id, { method: "DELETE" })).status, 201)
  })

  test("rejects oversized bodies and unknown API routes", async () => {
    const { calls, send } = harness()
    const big = { address: "a@example.org", note: "x".repeat(20_000) }
    assert.equal((await send("/api/allowlist", post(big))).status, 413)
    assert.equal((await send("/api/send")).status, 404)
    assert.equal((await send("/api/messages", post({}))).status, 404)
    assert.equal(calls.length, 0)
  })

  test("relays core errors without internal detail", async () => {
    const refused = harness({ status: 409, body: { error: "Preview expired" } })
    const conflict = await refused.send("/api/health")
    assert.equal(conflict.status, 409)
    assert.deepEqual(await conflict.json(), { error: "Preview expired" })

    const verbose = harness({ status: 400, body: { error: "x".repeat(400) } })
    assert.deepEqual(await (await verbose.send("/api/health")).json(), {
      error: "Request refused",
    })

    const crashed = harness({ status: 500, body: { error: "Traceback ..." } })
    const failure = await crashed.send("/api/health")
    assert.equal(failure.status, 502)
    assert.deepEqual(await failure.json(), { error: "Mail core error" })

    const down = harness(new Error("ECONNREFUSED /run/core.sock"))
    const unavailable = await down.send("/api/health")
    assert.equal(unavailable.status, 503)
    assert.deepEqual(await unavailable.json(), {
      error: "Mail core unavailable",
    })
  })
})

describe("core socket", () => {
  const dir = mkdtempSync(join(tmpdir(), "mail-web-"))
  after(() => rmSync(dir, { recursive: true, force: true }))

  test("sends the method, path, assertion and JSON body over the socket", async () => {
    const socket = join(dir, "core.sock")
    let seen: {
      method?: string
      url?: string
      headers: IncomingHttpHeaders
      body: string
    } = { headers: {}, body: "" }
    const server = createServer((req, res) => {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        seen = { method: req.method, url: req.url, headers: req.headers, body }
        res.writeHead(201, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ entry: { id: "x" } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(socket, resolve))
    try {
      const response = await socketForward(socket)({
        method: "POST",
        path: "/api/allowlist",
        body: { address: "a@example.org" },
        assertion: "jwt",
        timeoutMs: 1000,
      })
      assert.deepEqual(response, { status: 201, body: { entry: { id: "x" } } })
      assert.equal(seen.method, "POST")
      assert.equal(seen.url, "/api/allowlist")
      assert.equal(seen.headers["cf-access-jwt-assertion"], "jwt")
      assert.equal(seen.headers.cookie, undefined)
      assert.deepEqual(JSON.parse(seen.body), { address: "a@example.org" })
    } finally {
      server.close()
    }
  })

  test("fails when the socket is missing", async () => {
    await assert.rejects(
      socketForward(join(dir, "missing.sock"))({
        method: "GET",
        path: "/api/health",
        timeoutMs: 500,
      })
    )
  })
})

describe("production app", () => {
  test("request logs carry only the event, outcome and duration", () => {
    const line = requestLog({
      method: "PATCH",
      route: "/api/allowlist/:id",
      status: 404,
      durationMs: 12.345,
    })
    assert.deepEqual(line, {
      event: "mail_web_request",
      outcome: "error",
      total_ms: 12.3,
    })
    assert.equal(
      requestLog({ method: "GET", route: "/", status: 304, durationMs: 1 })
        .outcome,
      "ok"
    )
  })

  test("requires an Access assertion before reaching the core", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mail-web-"))
    const manifest = join(dir, "services.json")
    writeFileSync(manifest, "[]")
    let called = false
    const app = createCoreApp(
      {
        issuer: "https://team.example.com",
        audience: "aud",
        publicOrigin: "https://mail.example.com",
        serviceManifest: manifest,
        socket: join(dir, "core.sock"),
        hostname: "127.0.0.1",
        port: 8787,
      },
      {
        forward: async () => {
          called = true
          return { status: 200, body: {} }
        },
        staticRoot: dir,
      }
    )
    const response = await app.request("/api/overview")
    assert.equal(response.status, 401)
    assert.equal(called, false)
    assert.equal((await app.request("/metrics")).status, 403)
    rmSync(dir, { recursive: true, force: true })
  })
})
