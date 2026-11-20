import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/allowlist")({
  staticData: { crumb: "Allowlist" },
  component: Outlet,
})
