import { readFileSync } from "node:fs"
import {
  createShellServer,
  mountStatic,
  type RequestMetadata,
} from "@zsrobinson/shell/server"
import type { CoreConfig } from "./config.ts"
import { socketForward } from "./core-socket.ts"
import { registerMailRoutes, type Forward } from "./routes.ts"

/**
 * The only request log line. Method, route, status detail, addresses and
 * assertions are deliberately left out; the collector projects these fields.
 */
export function requestLog(metadata: RequestMetadata) {
  return {
    event: "mail_web_request",
    outcome: metadata.status < 400 ? "ok" : "error",
    total_ms: Math.round(metadata.durationMs * 10) / 10,
  } as const
}

/** Access-protected production app forwarding to the core socket. */
export function createCoreApp(
  config: CoreConfig,
  {
    forward = socketForward(config.socket),
    staticRoot = "./dist",
  }: { forward?: Forward; staticRoot?: string } = {}
) {
  const app = createShellServer({
    issuer: config.issuer,
    audience: config.audience,
    publicOrigin: config.publicOrigin,
    services: () => JSON.parse(readFileSync(config.serviceManifest, "utf8")),
    log: (metadata) => console.log(JSON.stringify(requestLog(metadata))),
    // A separate scrape token never grants access to app routes.
    metrics: {
      authorize: (request) =>
        Boolean(config.metricsToken) &&
        request.headers.get("Authorization") ===
          `Bearer ${config.metricsToken}`,
    },
  })
  registerMailRoutes(app, forward)
  mountStatic(app, staticRoot)
  return app
}
