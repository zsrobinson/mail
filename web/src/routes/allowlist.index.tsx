import { useDeferredValue } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { formatRelative } from "@zsrobinson/shell/lib/format"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@zsrobinson/shell/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import {
  NativeSelect,
  NativeSelectOption,
} from "@zsrobinson/shell/ui/native-select"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@zsrobinson/shell/ui/tabs"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import { EntryStateBadge } from "@/components/badges"
import { entryState, formatDate, formatInteger } from "@/lib/format"
import { allowlistQuery } from "@/lib/queries"
import type { AllowlistEntry, EntryState } from "@/lib/types"
import { useNow } from "@/lib/use-now"

const TABS = ["active", "expiring", "expired", "all"] as const
type Tab = (typeof TABS)[number]
const TAB_LABELS: Record<Tab, string> = {
  active: "Active",
  expiring: "Expiring soon",
  expired: "Expired",
  all: "All",
}
const SORTS = ["address", "expires", "matched", "matches"] as const
type Sort = (typeof SORTS)[number]
const SORT_LABELS: Record<Sort, string> = {
  address: "Address",
  expires: "Expires",
  matched: "Last matched",
  matches: "Matches, 30 days",
}

type Search = { q?: string; tab?: Tab; sort?: Sort; dir?: "asc" | "desc" }

export const Route = createFileRoute("/allowlist/")({
  validateSearch: (search): Search => ({
    q:
      typeof search.q === "string" && search.q
        ? search.q.slice(0, 100)
        : undefined,
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
    sort: SORTS.includes(search.sort as Sort)
      ? (search.sort as Sort)
      : undefined,
    dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
  }),
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(allowlistQuery)
  },
  component: AllowlistPage,
})

type Row = AllowlistEntry & { state: EntryState; recent: number[] }

function inTab(state: EntryState, tab: Tab) {
  if (tab === "all") return true
  if (tab === "active") return state !== "expired"
  return state === tab
}

function matchesQuery(entry: AllowlistEntry, query: string) {
  const q = query.trim().toLowerCase()
  return (
    !q ||
    entry.address.toLowerCase().includes(q) ||
    entry.note.toLowerCase().includes(q)
  )
}

const defaultDir = (sort: Sort) =>
  sort === "address" || sort === "expires" ? "asc" : "desc"

function compare(sort: Sort) {
  const sum = (r: Row) => r.recent.reduce((a, b) => a + b, 0)
  return (a: Row, b: Row) => {
    if (sort === "expires")
      return (
        (a.expires_at ? Date.parse(a.expires_at) : Infinity) -
          (b.expires_at ? Date.parse(b.expires_at) : Infinity) ||
        a.address.localeCompare(b.address)
      )
    if (sort === "matched")
      return (
        (a.last_matched_at ? Date.parse(a.last_matched_at) : 0) -
          (b.last_matched_at ? Date.parse(b.last_matched_at) : 0) ||
        a.address.localeCompare(b.address)
      )
    if (sort === "matches")
      return sum(a) - sum(b) || a.address.localeCompare(b.address)
    return a.address.localeCompare(b.address)
  }
}

function AllowlistPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const allowlist = useQuery(allowlistQuery)
  const query = useDeferredValue(search.q ?? "")
  const tab = search.tab ?? "active"
  const sort = search.sort ?? "address"
  const dir = search.dir ?? defaultDir(sort)
  const now = useNow()
  const rows: Row[] = (allowlist.data?.entries ?? []).map((entry) => ({
    ...entry,
    state: entryState(entry.expires_at, now),
    recent: entry.matches.slice(-30).map((m) => m.count),
  }))
  const counts = Object.fromEntries(
    TABS.map((t) => [t, rows.filter((r) => inTab(r.state, t)).length])
  ) as Record<Tab, number>
  const order = compare(sort)
  const shown = rows
    .filter((r) => inTab(r.state, tab) && matchesQuery(r, query))
    .toSorted((a, b) => (dir === "asc" ? order(a, b) : order(b, a)))
  const set = (patch: Search) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const setSort = (next: Sort) =>
    set(
      next === sort
        ? { dir: dir === "asc" ? "desc" : "asc" }
        : { sort: next === "address" ? undefined : next, dir: undefined }
    )
  return (
    <Page>
      <PageHeader>
        <div className="flex flex-col gap-1">
          <PageTitle>Allowlist</PageTitle>
          {allowlist.data ? (
            <PageMeta className="tabular-nums">
              <span>{formatInteger(counts.active)} active</span>
              {counts.expiring ? (
                <span>{formatInteger(counts.expiring)} expiring soon</span>
              ) : null}
              {counts.expired ? (
                <span>{formatInteger(counts.expired)} expired</span>
              ) : null}
            </PageMeta>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </div>
        <PageActions>
          <Button render={<Link to="/allowlist/new" />} nativeButton={false}>
            <PlusIcon data-icon="inline-start" />
            Add sender
          </Button>
        </PageActions>
      </PageHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={tab}
          onValueChange={(next) =>
            set({ tab: next === "active" ? undefined : (next as Tab) })
          }
        >
          <TabsList variant="line" className="max-w-full overflow-x-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
                {allowlist.data ? (
                  <span className="text-muted-foreground tabular-nums">
                    {counts[t]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <InputGroup className="w-full sm:w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search addresses and notes"
              placeholder="Search senders and notes"
              value={search.q ?? ""}
              onChange={(e) => set({ q: e.target.value || undefined })}
            />
          </InputGroup>
          <NativeSelect
            aria-label="Sort by"
            className="sm:hidden"
            value={`${sort}:${dir}`}
            onChange={(e) => {
              const [next, nextDir] = e.target.value.split(":") as [
                Sort,
                "asc" | "desc",
              ]
              set({
                sort: next === "address" ? undefined : next,
                dir: nextDir === defaultDir(next) ? undefined : nextDir,
              })
            }}
          >
            {SORTS.map((s) => (
              <NativeSelectOption key={s} value={`${s}:${defaultDir(s)}`}>
                {SORT_LABELS[s]}
              </NativeSelectOption>
            ))}
            {sort && dir !== defaultDir(sort) ? (
              <NativeSelectOption value={`${sort}:${dir}`}>
                {SORT_LABELS[sort]}, reversed
              </NativeSelectOption>
            ) : null}
          </NativeSelect>
        </div>
      </div>
      {allowlist.isError ? (
        <QueryError
          title="Allowlist could not be loaded"
          error={allowlist.error}
          onRetry={() => void allowlist.refetch()}
        />
      ) : !allowlist.data ? (
        <Skeleton className="h-80 rounded-3xl" />
      ) : shown.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {rows.length === 0
                ? "No senders allowed yet"
                : query.trim()
                  ? "No senders match"
                  : `No ${TAB_LABELS[tab].toLowerCase()} senders`}
            </EmptyTitle>
            {rows.length === 0 ? (
              <EmptyDescription>
                Bodies are only returned for authenticated mail from addresses
                on this list.
              </EmptyDescription>
            ) : null}
          </EmptyHeader>
          <EmptyContent>
            {rows.length === 0 ? (
              <Button
                render={<Link to="/allowlist/new" />}
                nativeButton={false}
              >
                Add sender
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => set({ q: undefined, tab: "all" })}
              >
                Show all senders
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="gap-0 py-0">
          <div
            role="row"
            className="grid grid-cols-[minmax(0,1fr)_7rem_7rem_9rem_1rem] items-center gap-x-4 border-b px-5 py-2 text-xs text-muted-foreground max-md:hidden"
          >
            {SORTS.map((s) => (
              <SortHeader
                key={s}
                label={SORT_LABELS[s]}
                active={sort === s}
                dir={dir}
                align={s === "matches" ? "right" : "left"}
                onClick={() => setSort(s)}
              />
            ))}
          </div>
          <ul className="divide-y divide-border/70">
            {shown.map((row) => (
              <li key={row.id}>
                <EntryRow row={row} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  )
}

function SortHeader({
  label,
  active,
  dir,
  align,
  onClick,
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  align: "left" | "right"
  onClick: () => void
}) {
  return (
    <span
      role="columnheader"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={onClick}
        className={`-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUpIcon aria-hidden className="size-3" />
          ) : (
            <ArrowDownIcon aria-hidden className="size-3" />
          )
        ) : null}
      </button>
    </span>
  )
}

/** Thirty days of matches as tiny bars; the number beside it is the total. */
function MatchBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts)
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${counts.length * 3} 16`}
      preserveAspectRatio="none"
      className="h-4 w-16 shrink-0"
    >
      {counts.map((count, i) => (
        <rect
          key={i}
          x={i * 3}
          width={2}
          y={count ? 16 - Math.max(2, (count / max) * 16) : 15}
          height={count ? Math.max(2, (count / max) * 16) : 1}
          className={count ? "fill-chart-1" : "fill-muted-foreground/25"}
        />
      ))}
    </svg>
  )
}

function EntryRow({ row }: { row: Row }) {
  const total = row.recent.reduce((a, b) => a + b, 0)
  return (
    <Link
      to="/allowlist/$id"
      params={{ id: row.id }}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:ring-inset md:grid-cols-[minmax(0,1fr)_7rem_7rem_9rem_1rem] md:py-2.5"
    >
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{row.address}</span>
          {row.state !== "active" ? (
            <EntryStateBadge state={row.state} />
          ) : null}
        </span>
        {row.note ? (
          <span className="truncate text-xs text-muted-foreground">
            {row.note}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground tabular-nums md:hidden">
          {row.expires_at
            ? `${row.state === "expired" ? "Expired" : "Until"} ${formatDate(row.expires_at)}`
            : "No end date"}
          {" · "}
          {row.last_matched_at
            ? `matched ${formatRelative(row.last_matched_at)}`
            : "never matched"}
        </span>
      </span>
      <span className="whitespace-nowrap tabular-nums max-md:hidden">
        {row.expires_at ? (
          <span
            className={
              row.state === "expired" ? "text-muted-foreground" : undefined
            }
          >
            {formatDate(row.expires_at)}
          </span>
        ) : (
          <span className="text-muted-foreground">No end</span>
        )}
      </span>
      <span className="whitespace-nowrap text-muted-foreground max-md:hidden">
        {row.last_matched_at ? formatRelative(row.last_matched_at) : "Never"}
      </span>
      <span className="flex items-center justify-end gap-2">
        <MatchBars counts={row.recent} />
        <span className="w-8 text-right font-medium tabular-nums">
          {formatInteger(total)}
        </span>
        <span className="sr-only">matches in the last 30 days</span>
      </span>
      <ChevronRightIcon
        aria-hidden
        className="size-4 text-muted-foreground/50 group-hover:text-muted-foreground max-md:hidden"
      />
    </Link>
  )
}
