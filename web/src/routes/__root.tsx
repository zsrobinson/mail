import { useQuery, type QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { AppShell, type AppLink, type NavItem } from "@zsrobinson/shell"
import {
  NotFound,
  RouteError,
  SignedOut,
} from "@zsrobinson/shell/blocks/page-states"
import {
  ActivityIcon,
  ChartColumnIcon,
  HeartPulseIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { AppBreadcrumbs } from "@/components/breadcrumbs"
import { ApiError } from "@/lib/api"
import { sessionQuery } from "@/lib/queries"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: ({ context: { queryClient } }) => {
      void queryClient.prefetchQuery(sessionQuery)
    },
    component: Root,
    notFoundComponent: () => <NotFound homeLabel="Go to overview" />,
    errorComponent: RouteError,
  }
)

const PAGES = [
  { to: "/", label: "Overview", icon: <ChartColumnIcon />, match: [] },
  {
    to: "/activity",
    label: "Activity",
    icon: <ActivityIcon />,
    match: ["/actions"],
  },
  {
    to: "/allowlist",
    label: "Allowlist",
    icon: <ShieldCheckIcon />,
    match: [],
  },
  { to: "/health", label: "Health", icon: <HeartPulseIcon />, match: [] },
] as const

function isActive(pathname: string, page: (typeof PAGES)[number]) {
  if (page.to === "/") return pathname === "/"
  return [page.to, ...page.match].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

function Root() {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const session = useQuery(sessionQuery)
  const signedOut =
    session.error instanceof ApiError && session.error.status === 401
  const items: NavItem[] = PAGES.map((page) => ({
    id: page.to,
    label: page.label,
    icon: page.icon,
    render: <Link to={page.to} />,
    onSelect: () => void navigate({ to: page.to }),
    active: isActive(pathname, page),
  }))
  return (
    <AppShell
      name="Mail"
      email={session.data?.email}
      apps={session.isError ? [] : (session.data?.services as AppLink[])}
      navGroups={[{ id: "main", items }]}
      breadcrumbs={<AppBreadcrumbs />}
    >
      {signedOut ? <SignedOut /> : <Outlet />}
    </AppShell>
  )
}
