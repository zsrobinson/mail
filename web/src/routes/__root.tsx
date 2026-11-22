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
  HistoryIcon,
  MailIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { AppBreadcrumbs } from "@/components/breadcrumbs"
import { ApiError } from "@/lib/api"
import { formatDate, shortId, TOOL_LABELS } from "@/lib/format"
import { allowlistQuery, recentWritesQuery, sessionQuery } from "@/lib/queries"

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
  // Hidden groups feed only the command palette.
  const allowlist = useQuery({ ...allowlistQuery, enabled: !signedOut })
  const writes = useQuery({ ...recentWritesQuery, enabled: !signedOut })
  const senders: NavItem[] = (allowlist.data?.entries ?? [])
    .toSorted((a, b) => a.address.localeCompare(b.address))
    .map((entry) => ({
      id: `sender-${entry.id}`,
      label: entry.address,
      icon: <MailIcon />,
      keywords: entry.note ? [entry.note] : undefined,
      render: <Link to="/allowlist/$id" params={{ id: entry.id }} />,
      onSelect: () =>
        void navigate({ to: "/allowlist/$id", params: { id: entry.id } }),
    }))
  const actions: NavItem[] = (writes.data?.rows ?? [])
    .filter((row) => row.action_id)
    .map((row) => ({
      id: `call-${row.id}`,
      label: `${TOOL_LABELS[row.tool]} ${shortId(row.action_id!)} · ${formatDate(row.time)}`,
      icon: <HistoryIcon />,
      keywords: [row.action_id!, row.action_id!.replaceAll("-", ""), row.id],
      render: <Link to="/activity/$id" params={{ id: row.id }} />,
      onSelect: () =>
        void navigate({ to: "/activity/$id", params: { id: row.id } }),
    }))
  const shortcuts: NavItem[] = [
    {
      id: "add-sender",
      label: "Add sender",
      icon: <PlusIcon />,
      render: <Link to="/allowlist/new" />,
      onSelect: () => void navigate({ to: "/allowlist/new" }),
    },
    {
      id: "refusals",
      label: "Refused body reads",
      icon: <ShieldAlertIcon />,
      keywords: ["not allowlisted", "not verified"],
      render: <Link to="/activity" search={{ refusals: true }} />,
      onSelect: () =>
        void navigate({ to: "/activity", search: { refusals: true } }),
    },
  ]
  return (
    <AppShell
      name="Mail"
      email={session.data?.email}
      apps={session.isError ? [] : (session.data?.services as AppLink[])}
      navGroups={[
        { id: "main", items },
        { id: "shortcuts", label: "Shortcuts", hidden: true, items: shortcuts },
        { id: "senders", label: "Allowlist", hidden: true, items: senders },
        {
          id: "actions",
          label: "Recent write actions",
          hidden: true,
          items: actions,
        },
      ]}
      searchPlaceholder="Jump to a page, sender or action id…"
      breadcrumbs={<AppBreadcrumbs />}
    >
      {signedOut ? <SignedOut /> : <Outlet />}
    </AppShell>
  )
}
