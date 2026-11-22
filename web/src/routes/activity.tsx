import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/activity")({
  staticData: { crumb: "Activity" },
  component: Outlet,
})
