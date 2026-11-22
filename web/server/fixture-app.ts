import { Hono } from "hono"
import { createFixtures } from "./fixtures.ts"
import { registerMailRoutes } from "./routes.ts"

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

/**
 * Loopback-only development API with synthetic data. There is no Access
 * check because there is nothing real behind it; config.ts refuses to start
 * this mode beside Access or a core socket.
 */
export function createFixtureApp(now = () => Date.now()) {
  const app = new Hono()
  app.onError((_error, c) => c.json({ error: "Internal server error" }, 500))
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff")
    c.header("Referrer-Policy", "same-origin")
    c.header("Content-Security-Policy", CSP)
    const origin = c.req.header("Origin")
    if (
      !["GET", "HEAD"].includes(c.req.method) &&
      origin &&
      !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
    )
      return c.json({ error: "Origin rejected" }, 403)
    await next()
  })
  app.get("/api/session", (c) =>
    c.json({
      email: "operator@example.org",
      services: [
        { name: "Mail", url: "/", colour: "cy" },
        { name: "Grafana", url: "https://grafana.example.org", icon: "G" },
      ],
    })
  )
  registerMailRoutes(app, createFixtures(now).forward)
  return app
}
