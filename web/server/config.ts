export type CoreConfig = {
  issuer: string
  audience: string
  publicOrigin: string
  serviceManifest: string
  socket: string
  hostname: string
  port: number
  metricsToken?: string
}
export type FixtureConfig = { hostname: string; port: number }

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"])

function listen(env: NodeJS.ProcessEnv) {
  const hostname = env.BIND_ADDRESS || "127.0.0.1"
  const port = Number(env.PORT || 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("PORT must be a TCP port")
  return { hostname, port }
}

/** Production: Access and the private core socket are both required. */
export function loadCoreConfig(env: NodeJS.ProcessEnv): CoreConfig {
  if (env.MAIL_FIXTURES)
    throw Error("MAIL_FIXTURES is for npm run dev:fixtures only")
  const required = (key: string) => {
    const value = env[key]
    if (!value) throw Error(`Missing ${key}`)
    return value
  }
  const issuer = required("ACCESS_ISSUER")
  if (!issuer.startsWith("https://"))
    throw Error("ACCESS_ISSUER must be an HTTPS origin")
  return {
    issuer,
    audience: required("ACCESS_AUD"),
    publicOrigin: required("PUBLIC_ORIGIN"),
    serviceManifest: required("SERVICE_MANIFEST"),
    socket: required("MAIL_CORE_SOCKET"),
    metricsToken: env.METRICS_TOKEN || undefined,
    ...listen(env),
  }
}

/**
 * Synthetic fixtures are a development aid only. They refuse to start beside
 * any Access or core configuration, in production, or off loopback.
 */
export function loadFixtureConfig(env: NodeJS.ProcessEnv): FixtureConfig {
  if (env.MAIL_FIXTURES !== "1") throw Error("Set MAIL_FIXTURES=1")
  const conflicting = [
    "ACCESS_ISSUER",
    "ACCESS_AUD",
    "PUBLIC_ORIGIN",
    "MAIL_CORE_SOCKET",
  ].filter((key) => env[key])
  if (conflicting.length)
    throw Error(
      `Fixtures refuse to start while ${conflicting.join(", ")} is set`
    )
  if (env.NODE_ENV === "production")
    throw Error("Fixtures refuse to start with NODE_ENV=production")
  const config = listen(env)
  if (!LOOPBACK.has(config.hostname))
    throw Error("Fixtures only bind to loopback")
  return config
}
