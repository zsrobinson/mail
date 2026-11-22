import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageTitle,
} from "@zsrobinson/shell"
import {
  ChartRangeSelect,
  DonutChart,
  TrendChart,
  type ChartRangeOption,
} from "@zsrobinson/shell/blocks/chart-card"
import { DetailList, DetailRow } from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Stat, StatDelta, StatRow } from "@zsrobinson/shell/blocks/stat"
import { formatRelative } from "@zsrobinson/shell/lib/format"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@zsrobinson/shell/ui/card"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  ShieldAlertIcon,
  UnplugIcon,
} from "lucide-react"
import { EntryStateBadge, StateBadge } from "@/components/badges"
import { CategoryBars, LatencySparkline } from "@/components/charts"
import {
  bucketFormat,
  formatInteger,
  formatMs,
  KIND_LABELS,
  OUTCOME_SERIES,
  REFUSAL_LABELS,
} from "@/lib/format"
import { overviewQuery } from "@/lib/queries"
import {
  RANGES,
  REFUSAL_REASONS,
  type AttentionItem,
  type Overview,
  type Range,
} from "@/lib/types"

const RANGE_OPTIONS: ChartRangeOption<Range>[] = [
  { value: "24h", label: "Last 24 hours", duration: 86_400 },
  { value: "7d", label: "Last 7 days", duration: 604_800 },
  { value: "30d", label: "Last 30 days", duration: 2_592_000 },
]
const PERIOD: Record<Range, string> = {
  "24h": "previous 24 hours",
  "7d": "previous 7 days",
  "30d": "previous 30 days",
}

export const Route = createFileRoute("/")({
  staticData: { crumb: "Overview" },
  validateSearch: (search): { range?: Range } =>
    RANGES.includes(search.range as Range)
      ? { range: search.range as Range }
      : {},
  loaderDeps: ({ search }) => ({ range: search.range ?? "7d" }),
  loader: ({ context: { queryClient }, deps }) => {
    void queryClient.prefetchQuery(overviewQuery(deps.range))
  },
  component: OverviewPage,
})

const readsConfig = {
  allowed: { label: "Returned", color: "var(--chart-1)" },
  refused: { label: "Refused", color: "var(--chart-3)" },
}
const writesConfig = { value: { label: "Messages", color: "var(--chart-1)" } }
const REASON_COLORS = {
  sender_not_allowlisted: "var(--chart-3)",
  sender_not_verified: "var(--chart-4)",
}

function OverviewPage() {
  const range = Route.useSearch({ select: (s) => s.range ?? "7d" })
  const navigate = Route.useNavigate()
  const overview = useQuery(overviewQuery(range))
  return (
    <Page>
      <PageHeader>
        <PageTitle>Overview</PageTitle>
        <PageActions>
          <ChartRangeSelect
            value={range}
            ranges={RANGE_OPTIONS}
            onChange={(next) =>
              void navigate({
                search: next === "7d" ? {} : { range: next },
                replace: true,
              })
            }
          />
        </PageActions>
      </PageHeader>
      {overview.isError ? (
        <QueryError
          title="Overview could not be loaded"
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      ) : overview.data ? (
        <OverviewCards data={overview.data} range={range} />
      ) : (
        <OverviewSkeleton />
      )}
    </Page>
  )
}

/** The one style for a card's "go to" action: quiet, with an arrow. */
function CardLink({
  to,
  search,
  params,
  children,
}: {
  to: string
  search?: Record<string, unknown>
  params?: Record<string, string>
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      render={
        <Link to={to} search={search as never} params={params as never} />
      }
      nativeButton={false}
    >
      {children}
      <ArrowRightIcon data-icon="inline-end" />
    </Button>
  )
}

function OverviewCards({ data, range }: { data: Overview; range: Range }) {
  const t = data.totals
  const p = data.previous
  const period = PERIOD[range]
  const refused =
    t.refusals.sender_not_allowlisted + t.refusals.sender_not_verified
  const formatTime = bucketFormat(data.bucket_seconds)
  const writes = data.writes_by_kind.map((w) => ({
    name: KIND_LABELS[w.kind],
    value: w.messages,
    detail: `${formatInteger(w.messages)} messages in ${formatInteger(w.calls)} calls`,
  }))
  const activityRange = range === "7d" ? undefined : range
  return (
    <>
      {data.attention.length ? (
        <AttentionCard items={data.attention} range={range} />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Calls</CardTitle>
          <CardAction>
            <CardLink to="/activity" search={{ range: activityRange }}>
              Activity
            </CardLink>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <StatRow className="sm:gap-x-12">
            <Stat
              label="Calls"
              delta={
                <StatDelta
                  current={t.calls}
                  previous={p.calls}
                  better="none"
                  period={period}
                />
              }
            >
              {formatInteger(t.calls)}
            </Stat>
            <Stat
              label="Failed"
              delta={
                <StatDelta
                  current={t.failed}
                  previous={p.failed}
                  better="down"
                  period={period}
                />
              }
            >
              {formatInteger(t.failed)}
            </Stat>
            <Stat
              label="Write calls"
              delta={
                <StatDelta
                  current={t.writes}
                  previous={p.writes}
                  better="none"
                  period={period}
                />
              }
            >
              {formatInteger(t.writes)}
            </Stat>
            <Stat
              label="Messages changed"
              delta={
                <StatDelta
                  current={t.messages_changed}
                  previous={p.messages_changed}
                  better="none"
                  period={period}
                />
              }
            >
              {formatInteger(t.messages_changed)}
            </Stat>
          </StatRow>
          <TrendChart
            integer
            kind="bar"
            stacked
            data={data.calls.map((c) => ({
              time: Date.parse(c.start),
              ok: c.ok,
              refused: c.refused,
              error: c.error,
            }))}
            config={OUTCOME_SERIES}
            formatTime={formatTime}
            label="Tool calls per period by outcome: succeeded, refused and failed"
          />
        </CardContent>
      </Card>
      <PageGrid layout="two" className="items-stretch">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Body reads</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <StatRow>
              <Stat
                label="Returned"
                delta={
                  <StatDelta
                    current={t.body_reads_allowed}
                    previous={p.body_reads_allowed}
                    better="none"
                    period={period}
                  />
                }
              >
                {formatInteger(t.body_reads_allowed)}
              </Stat>
              <Stat
                label="Refused"
                delta={
                  <StatDelta
                    current={t.body_reads_refused}
                    previous={p.body_reads_refused}
                    better="down"
                    period={period}
                  />
                }
              >
                {formatInteger(t.body_reads_refused)}
              </Stat>
            </StatRow>
            <TrendChart
              integer
              kind="bar"
              stacked
              data={data.body_reads.map((r) => ({
                time: Date.parse(r.start),
                allowed: r.allowed,
                refused: r.refused,
              }))}
              config={readsConfig}
              formatTime={formatTime}
              label="Message bodies returned and refused per period"
              className="h-44"
            />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Refusals by reason</CardTitle>
            <CardAction>
              <CardLink
                to="/activity"
                search={{ refusals: true, range: activityRange }}
              >
                Refused calls
              </CardLink>
            </CardAction>
          </CardHeader>
          <CardContent>
            {refused === 0 ? (
              <p className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                No bodies refused in this period
              </p>
            ) : (
              <DonutChart
                label="Refused message bodies by reason"
                totalLabel="Refused"
                data={REFUSAL_REASONS.filter((r) => t.refusals[r] > 0).map(
                  (reason) => ({
                    key: reason,
                    label: REFUSAL_LABELS[reason],
                    value: t.refusals[reason],
                    color: REASON_COLORS[reason],
                  })
                )}
              />
            )}
          </CardContent>
        </Card>
      </PageGrid>
      <PageGrid layout="two" className="items-stretch">
        <TopSendersCard data={data} />
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Messages changed by kind</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBars
              rows={writes}
              config={writesConfig}
              label="Messages changed by write kind"
            />
          </CardContent>
        </Card>
      </PageGrid>
      <Card>
        <CardHeader>
          <CardTitle>Bridge</CardTitle>
          <CardAction className="flex items-center gap-1">
            <StateBadge state={data.bridge.state} />
            <CardLink to="/health">Health</CardLink>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center">
          <DetailList>
            <DetailRow label="Login latency">
              {formatMs(data.bridge.latency_ms)}
            </DetailRow>
            <DetailRow label="Last success">
              {data.bridge.last_success_at
                ? formatRelative(data.bridge.last_success_at)
                : "Never"}
            </DetailRow>
          </DetailList>
          <LatencySparkline
            points={data.bridge.latency}
            label="Recent Bridge login latency"
          />
        </CardContent>
      </Card>
    </>
  )
}

function TopSendersCard({ data }: { data: Overview }) {
  const max = Math.max(1, ...data.top_senders.map((s) => s.matches))
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Top allowlist entries</CardTitle>
        <CardAction>
          <CardLink to="/allowlist">Allowlist</CardLink>
        </CardAction>
      </CardHeader>
      <CardContent>
        {data.top_senders.length === 0 ? (
          <p className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No allowed reads in this period
          </p>
        ) : (
          <ol className="-my-1 flex flex-col">
            {data.top_senders.map((sender) => (
              <li key={sender.id}>
                <Link
                  to="/allowlist/$id"
                  params={{ id: sender.id }}
                  className="-mx-2 flex flex-col gap-1.5 rounded-xl px-2 py-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <span className="flex min-w-0 items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {sender.address}
                      </span>
                      {sender.state !== "active" ? (
                        <EntryStateBadge state={sender.state} />
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatInteger(sender.matches)}{" "}
                      <span className="text-muted-foreground">
                        {sender.matches === 1 ? "match" : "matches"}
                      </span>
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className="block h-full rounded-full bg-chart-1"
                      style={{ width: `${(sender.matches / max) * 100}%` }}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

const ICONS: Record<string, ReactNode> = {
  bridge: <UnplugIcon />,
  refusal_spike: <ShieldAlertIcon />,
  expiring: <CalendarClockIcon />,
  expired: <CalendarClockIcon />,
}

function attentionText(item: AttentionItem): {
  text: ReactNode
  link: ReactNode
} {
  const health = <CardLink to="/health">Health</CardLink>
  switch (item.kind) {
    case "allowlist_unavailable":
      return {
        text: "The allowlist store cannot be read, so every body read is refused until it is fixed.",
        link: health,
      }
    case "authserv_missing":
      return {
        text: "No trusted authserv id is configured, so no sender can be verified and every body read is refused.",
        link: health,
      }
    case "audit_refuses_all":
      return {
        text: "The last header audit found no allowlisted message that would pass verification. The trusted authserv id is probably wrong.",
        link: health,
      }
    case "bridge":
      return {
        text:
          item.state === "down"
            ? "Bridge logins are failing, so mail tools cannot reach the mailbox."
            : "Some recent Bridge logins failed. Calls may be slow or fail until it recovers.",
        link: health,
      }
    case "refusal_spike":
      return {
        text: `${formatInteger(item.count ?? 0)} message bodies were refused in this period, up from ${formatInteger(item.previous ?? 0)}.`,
        link: null,
      }
    case "expiring":
    case "expired":
      return {
        text: (
          <>
            <span className="font-medium">{item.address}</span>{" "}
            {item.kind === "expiring" ? "expires" : "expired"}{" "}
            {item.time ? formatRelative(item.time) : ""}.
          </>
        ),
        link: item.entry_id ? (
          <CardLink
            to="/allowlist/$id"
            params={{ id: item.entry_id }}
            search={{ focus: "expiry" }}
          >
            {item.kind === "expiring" ? "Extend" : "Renew"}
          </CardLink>
        ) : null,
      }
    default:
      return { text: item.kind, link: null }
  }
}

function AttentionCard({
  items,
  range,
}: {
  items: AttentionItem[]
  range: Range
}) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="-my-1 divide-y divide-border/70">
          {items.map((item, index) => {
            const { text, link } = attentionText(item)
            return (
              <li
                key={`${item.kind}-${item.entry_id ?? index}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
              >
                <span className="flex min-w-0 items-start gap-2.5 text-sm">
                  <span
                    className={
                      item.severity === "critical"
                        ? "mt-0.5 text-destructive [&_svg]:size-4"
                        : item.severity === "warning"
                          ? "mt-0.5 text-chart-3 [&_svg]:size-4"
                          : "mt-0.5 text-muted-foreground [&_svg]:size-4"
                    }
                    aria-hidden
                  >
                    {ICONS[item.kind] ?? <CircleAlertIcon />}
                  </span>
                  <span className="sr-only">
                    {item.severity === "critical"
                      ? "Critical: "
                      : item.severity === "warning"
                        ? "Warning: "
                        : ""}
                  </span>
                  <span className="min-w-0">{text}</span>
                </span>
                {item.kind === "refusal_spike" ? (
                  <CardLink
                    to="/activity"
                    search={{
                      refusals: true,
                      range: range === "7d" ? undefined : range,
                    }}
                  >
                    Refused calls
                  </CardLink>
                ) : (
                  link
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function OverviewSkeleton() {
  return (
    <>
      <Skeleton className="h-96 rounded-3xl" />
      <PageGrid layout="two">
        <Skeleton className="h-80 rounded-3xl" />
        <Skeleton className="h-80 rounded-3xl" />
      </PageGrid>
      <Skeleton className="h-36 rounded-3xl" />
    </>
  )
}
