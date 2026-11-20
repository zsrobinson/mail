/** Development only: synthetic data on loopback for `npm run dev`. */
import { serve } from "@zsrobinson/shell/server"
import { loadFixtureConfig } from "./config.ts"
import { createFixtureApp } from "./fixture-app.ts"

const config = loadFixtureConfig(process.env)
serve({
  fetch: createFixtureApp().fetch,
  hostname: config.hostname,
  port: config.port,
})
console.log(`Synthetic fixtures on http://${config.hostname}:${config.port}`)
