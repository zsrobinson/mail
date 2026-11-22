import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import {
  DateRangePicker,
  type DateRangeValue,
} from "@zsrobinson/shell/blocks/date-picker"
import {
  FilterBar,
  FilterChips,
  MultiSelect,
  type FilterChip,
} from "@zsrobinson/shell/blocks/filter-bar"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import {
  addDays,
  formatCalendarRange,
  fromCalendarDate,
  isCalendarDate,
} from "@zsrobinson/shell/lib/calendar-date"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card, CardContent, CardFooter } from "@zsrobinson/shell/ui/card"
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
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import { Toggle } from "@zsrobinson/shell/ui/toggle"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  ShieldAlertIcon,
} from "lucide-react"
import { CallRow } from "@/components/call-row"
import {
  bucketFormat,
  formatDayHeading,
  formatInteger,
  localDay,
  OUTCOME_LABELS,
  TOOL_LABELS,
} from "@/lib/format"
import { activityQuery } from "@/lib/queries"
import { useNow } from "@/lib/use-now"
import {
  OUTCOMES,
  TOOLS,
  type ActivityFilters,
  type ActivityRow,
  type Outcome,
  type Tool,
} from "@/lib/types"

const PAGE = 50
const PRESETS = [
  { value: "24h", label: "Last 24 hours", days: 1 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: 0 },
] as const
type Preset = (typeof PRESETS)[number]["value"]
const DEFAULT_PRESET: Preset = "7d"

export type ActivitySearch = {
  q?: string
  range?: Preset
  from?: string
  to?: string
  /** Comma-separated tool ids. */
  tool?: string
  /** Comma-separated outcomes. */
  outcome?: string
  refusals?: boolean
  page?: number
}

const list = <T extends string>(value: unknown, allowed: readonly T[]) => {
  if (typeof value !== "string") return undefined
  const items = value.split(",").filter((v): v is T => allowed.includes(v as T))
  return items.length ? [...new Set(items)].join(",") : undefined
}

export const Route = createFileRoute("/activity/")({
  validateSearch: (search): ActivitySearch => {
    const custom =
      isCalendarDate(search.from) || isCalendarDate(search.to)
        ? {
            from: isCalendarDate(search.from) ? search.from : undefined,
            to: isCalendarDate(search.to) ? search.to : undefined,
          }
        : {}
    const page = Number(search.page)
    return {
      q:
        typeof search.q === "string" && search.q.trim()
          ? search.q.slice(0, 200)
          : undefined,
      range: PRESETS.some((p) => p.value === search.range)
        ? (search.range as Preset)
        : undefined,
      ...custom,
      tool: list(search.tool, [...TOOLS, "unknown"] as Tool[]),
      outcome: list(search.outcome, OUTCOMES),
      refusals:
        search.refusals === true || search.refusals === "true"
          ? true
          : undefined,
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    }
  },
  component: ActivityPage,
})

/** The filters the API understands, from the URL. */
function apiFilters(search: ActivitySearch, minute: number): ActivityFilters {
  let from: string | undefined
  let to: string | undefined
  if (search.from || search.to) {
    if (search.from) from = fromCalendarDate(search.from).toISOString()
    if (search.to)
      to = fromCalendarDate(
        addDays(1, fromCalendarDate(search.to))
      ).toISOString()
  } else {
    const preset = PRESETS.find(
      (p) => p.value === (search.range ?? DEFAULT_PRESET)
    )!
    if (preset.days)
      from = new Date(minute - preset.days * 86_400_000).toISOString()
  }
  return {
    q: search.q,
    from,
    to,
    tools: search.tool?.split(",") as Tool[] | undefined,
    outcomes: search.outcome?.split(",") as Outcome[] | undefined,
    refusals: search.refusals,
    offset: ((search.page ?? 1) - 1) * PAGE,
    limit: PAGE,
  }
}

function useMinute() {
  return Math.floor(useNow(30_000) / 60_000) * 60_000
}

const TOOL_GROUPS: Record<string, Tool[]> = {
  Reads: [
    "list_folders",
    "list_messages",
    "search_messages",
    "list_unsubscribe",
    "read_messages",
    "list_actions",
  ],
  Writes: [
    "archive_messages",
    "unarchive_messages",
    "move_messages",
    "add_labels",
    "mark_read",
    "create_draft",
  ],
}
const TOOL_OPTIONS = Object.entries(TOOL_GROUPS).flatMap(([group, tools]) =>
  tools.map((tool) => ({ value: tool, label: TOOL_LABELS[tool], group }))
)

const chartConfig = {
  ok: { label: "Succeeded", color: "var(--chart-1)" },
  refused: { label: "Refused", color: "var(--chart-3)" },
  error: { label: "Failed", color: "var(--destructive)" },
}

function ActivityPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const minute = useMinute()
  const filters = useMemo(() => apiFilters(search, minute), [search, minute])
  const activity = useQuery(activityQuery(filters))
  const set = (patch: Partial<ActivitySearch>) =>
    void navigate({
      search: (prev) => ({ ...prev, page: undefined, ...patch }),
    })
  const [text, setText] = useState(search.q ?? "")
  // Follow the URL when it changes elsewhere (Back, a chip, Clear all).
  const [urlQ, setUrlQ] = useState(search.q)
  if (urlQ !== search.q) {
    setUrlQ(search.q)
    setText(search.q ?? "")
  }
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? "") !== text.trim())
        void navigate({
          search: (prev) => ({
            ...prev,
            page: undefined,
            q: text.trim() || undefined,
          }),
          replace: true,
        })
    }, 300)
    return () => clearTimeout(id)
  }, [text, search.q, navigate])

  const tools = search.tool?.split(",") ?? []
  const outcomes = search.outcome?.split(",") ?? []
  const custom = Boolean(search.from || search.to)
  const preset = PRESETS.find(
    (p) => p.value === (search.range ?? DEFAULT_PRESET)
  )!
  const range: DateRangeValue = custom
    ? { from: search.from, to: search.to }
    : { preset: preset.value }
  const chips: FilterChip[] = [
    ...(search.q
      ? [
          {
            id: "q",
            label: "Search",
            value: `“${search.q}”`,
            onRemove: () => set({ q: undefined }),
          },
        ]
      : []),
    ...(custom || search.range
      ? [
          {
            id: "range",
            label: "Date",
            value: custom
              ? formatCalendarRange(search.from, search.to)
              : preset.label,
            onRemove: () =>
              set({ range: undefined, from: undefined, to: undefined }),
          },
        ]
      : []),
    ...(tools.length
      ? [
          {
            id: "tool",
            label: "Tool",
            value: tools.map((t) => TOOL_LABELS[t as Tool] ?? t).join(", "),
            onRemove: () => set({ tool: undefined }),
          },
        ]
      : []),
    ...(outcomes.length
      ? [
          {
            id: "outcome",
            label: "Outcome",
            value: outcomes.map((o) => OUTCOME_LABELS[o as Outcome]).join(", "),
            onRemove: () => set({ outcome: undefined }),
          },
        ]
      : []),
    ...(search.refusals
      ? [
          {
            id: "refusals",
            label: "Only",
            value: "Refused body reads",
            onRemove: () => set({ refusals: undefined }),
          },
        ]
      : []),
  ]
  const filtered = chips.length > 0
  const clear = () => {
    setText("")
    void navigate({ search: {} })
  }
  const data = activity.data
  const page = search.page ?? 1
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1
  return (
    <Page>
      <PageHeader>
        <div className="flex flex-col gap-1">
          <PageTitle>Activity</PageTitle>
          <PageMeta aria-live="polite">
            {data ? (
              data.total === 0 ? (
                <span>No calls</span>
              ) : (
                <span className="tabular-nums">
                  Showing {formatInteger(data.offset + 1)}–
                  {formatInteger(data.offset + data.rows.length)} of{" "}
                  {formatInteger(data.total)}{" "}
                  {data.total === 1 ? "call" : "calls"}
                </span>
              )
            ) : (
              <Skeleton className="h-5 w-40" />
            )}
          </PageMeta>
        </div>
        <PageActions>
          <DateRangePicker
            value={range}
            presets={PRESETS.map(({ value, label }) => ({ value, label }))}
            onChange={(next) =>
              set(
                next.preset
                  ? {
                      range:
                        next.preset === DEFAULT_PRESET
                          ? undefined
                          : (next.preset as Preset),
                      from: undefined,
                      to: undefined,
                    }
                  : { range: undefined, from: next.from, to: next.to }
              )
            }
          />
        </PageActions>
      </PageHeader>
      <div className="flex flex-col gap-2">
        <FilterBar>
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search activity"
              placeholder="Action id, tool or error"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </InputGroup>
          <MultiSelect
            label="Tools"
            options={TOOL_OPTIONS}
            value={tools}
            onChange={(next) =>
              set({ tool: next.length ? next.join(",") : undefined })
            }
          />
          <MultiSelect
            label="Outcomes"
            options={OUTCOMES.map((o) => ({
              value: o,
              label: OUTCOME_LABELS[o],
            }))}
            value={outcomes}
            onChange={(next) =>
              set({ outcome: next.length ? next.join(",") : undefined })
            }
          />
          <Toggle
            variant="outline"
            size="sm"
            pressed={Boolean(search.refusals)}
            onPressedChange={(pressed) =>
              set({ refusals: pressed || undefined })
            }
          >
            <ShieldAlertIcon data-icon="inline-start" />
            Refusals only
          </Toggle>
        </FilterBar>
        <FilterChips chips={chips} onClear={clear} />
      </div>
      {activity.isError ? (
        <QueryError
          title="Activity could not be loaded"
          error={activity.error}
          onRetry={() => void activity.refetch()}
        />
      ) : !data ? (
        <>
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-[28rem] rounded-3xl" />
        </>
      ) : (
        <>
          <Card>
            <CardContent>
              <TrendChart
                integer
                kind="bar"
                stacked
                data={data.series.points.map((p) => ({
                  time: Date.parse(p.start),
                  ok: p.ok,
                  refused: p.refused,
                  error: p.error,
                }))}
                config={chartConfig}
                formatTime={bucketFormat(data.series.bucket_seconds)}
                label={`Calls per ${data.series.bucket_seconds >= 604_800 ? "week" : data.series.bucket_seconds >= 86_400 ? "day" : "hour"} matching these filters, by outcome`}
                className="h-44"
              />
            </CardContent>
          </Card>
          {data.total === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>
                  {filtered ? "No calls match these filters" : "No calls yet"}
                </EmptyTitle>
                <EmptyDescription>
                  {filtered
                    ? "Try a wider date range or fewer filters."
                    : "Calls from agents appear here as they happen."}
                </EmptyDescription>
              </EmptyHeader>
              {filtered ? (
                <EmptyContent>
                  <Button variant="outline" onClick={clear}>
                    Clear filters
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <Card className="gap-0 overflow-clip py-0">
              <DayGroups rows={data.rows} />
              {pages > 1 ? (
                <CardFooter className="justify-between gap-2 border-t py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    render={
                      page > 1 ? (
                        <Link
                          from={Route.fullPath}
                          search={(prev) => ({
                            ...prev,
                            page: page - 1 > 1 ? page - 1 : undefined,
                          })}
                        />
                      ) : undefined
                    }
                    nativeButton={page <= 1}
                  >
                    <ChevronLeftIcon data-icon="inline-start" />
                    Newer
                  </Button>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    Page {formatInteger(page)} of {formatInteger(pages)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pages}
                    render={
                      page < pages ? (
                        <Link
                          from={Route.fullPath}
                          search={(prev) => ({ ...prev, page: page + 1 })}
                        />
                      ) : undefined
                    }
                    nativeButton={page >= pages}
                  >
                    Older
                    <ChevronRightIcon data-icon="inline-end" />
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          )}
        </>
      )}
    </Page>
  )
}

function DayGroups({ rows }: { rows: ActivityRow[] }) {
  const groups: { day: string; rows: ActivityRow[] }[] = []
  for (const row of rows) {
    const day = localDay(row.time)
    const last = groups.at(-1)
    if (last?.day === day) last.rows.push(row)
    else groups.push({ day, rows: [row] })
  }
  return (
    <div>
      {groups.map((group) => (
        <section key={group.day} aria-label={formatDayHeading(group.day)}>
          <h2 className="sticky top-12 z-10 flex items-center justify-between border-b bg-card/95 px-5 py-2 text-xs font-medium text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <span>{formatDayHeading(group.day)}</span>
            <span className="tabular-nums">
              {formatInteger(group.rows.length)}{" "}
              {group.rows.length === 1 ? "call" : "calls"}
            </span>
          </h2>
          <ul className="divide-y divide-border/70">
            {group.rows.map((row) => (
              <li key={row.id}>
                <CallRow row={row} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
