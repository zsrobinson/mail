import { Fragment, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useMatches } from "@tanstack/react-router"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@zsrobinson/shell/ui/breadcrumb"
import { allowlistEntryQuery } from "@/lib/queries"

type Crumb = { label: ReactNode; to: string; params?: Record<string, string> }

function EntryLabel({ id }: { id: string }) {
  const entry = useQuery(allowlistEntryQuery(id))
  return entry.data?.entry.address ?? "Sender"
}

/** Section › page, from each matched route's static crumb. */
export function AppBreadcrumbs() {
  const matches = useMatches()
  const crumbs: Crumb[] = []
  for (const match of matches) {
    const params = match.params as Record<string, string>
    if (match.routeId === "/actions/$id")
      // Actions are reached from Activity; show a short id, the page has the full one.
      crumbs.push(
        { label: "Activity", to: "/activity" },
        { label: params.id.slice(0, 8), to: match.fullPath, params }
      )
    const label =
      match.routeId === "/allowlist/$id" ? (
        <EntryLabel id={params.id} />
      ) : (
        match.staticData.crumb
      )
    if (label) crumbs.push({ label, to: match.fullPath, params })
  }
  if (crumbs.length === 0) return null
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <Fragment key={crumb.to}>
              {index > 0 ? (
                <BreadcrumbSeparator className="max-sm:hidden" />
              ) : null}
              <BreadcrumbItem className={last ? "min-w-0" : "max-sm:hidden"}>
                {last ? (
                  <BreadcrumbPage className="truncate">
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={<Link to={crumb.to} params={crumb.params} />}
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
