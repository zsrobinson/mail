import { fileURLToPath } from "node:url"
import { relative } from "node:path"
import { serve } from "@zsrobinson/shell/server"
import { createCoreApp } from "./server/app.ts"
import { loadCoreConfig } from "./server/config.ts"

const config = loadCoreConfig(process.env)
// The bundle lives in dist-server/; static files are its sibling dist/.
const staticRoot =
  relative(process.cwd(), fileURLToPath(new URL("../dist", import.meta.url))) ||
  "."
const app = createCoreApp(config, { staticRoot })
serve({ fetch: app.fetch, hostname: config.hostname, port: config.port })
