import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import {
  ChartRangeSelect,
  type ChartRangeOption,
} from "@zsrobinson/shell/blocks/chart-card"
import { CopyButton } from "@zsrobinson/shell/blocks/copy-button"
import {
  DetailList,
  DetailRow,
  Unavailable,
} from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import {
  StatusLegend,
  StatusTimeline,
} from "@zsrobinson/shell/blocks/status-timeline"
import { formatRelative } from "@zsrobinson/shell/lib/format"
import { Alert, AlertDescription, AlertTitle } from "@zsrobinson/shell/ui/alert"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@zsrobinson/shell/ui/card"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import { ExternalLinkIcon, TriangleAlertIcon } from "lucide-react"
import { ErrorClassBadge, StateBadge, ToneBadge } from "@/components/badges"
import { LatencySparkline } from "@/components/charts"
import {
  bucketFormat,
  COMPONENT_LABELS,
  formatInteger,
  formatMs,
  formatPrecise,
  STATE_LABELS,
} from "@/lib/format"
import { healthQuery, sessionQuery } from "@/lib/queries"
import {
  RANGES,
  type Enforcement,
  type Health,
  type HealthComponent,
  type Range,
  type State,
} from "@/lib/types"

const RANGE_OPTIONS: ChartRangeOption<Range>[] = [
  { value: "24h", label: "Last 24 hours", duration: 86_400 },
  { value: "7d", label: "Last 7 days", duration: 604_800 },
  { value: "30d", label: "Last 30 days", duration: 2_592_000 },
]
const RANGE_WORDS: Record<Range, string> = {
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
}

export const Route = createFileRoute("/health")({
  staticData: { crumb: "Health" },
  validateSearch: (search): { range?: Range } =>
    RANGES.includes(search.range as Range)
      ? { range: search.range as Range }
      : {},
  loaderDeps: ({ search }) => ({ range: search.range ?? "24h" }),
  loader: ({ context: { queryClient }, deps }) => {
    void queryClient.prefetchQuery(healthQuery(deps.range))
  },
  component: HealthPage,
})

/** What a component's state means and what to check, in a sentence or two. */
const EXPLAIN: Record<string, Partial<Record<State, string>>> = {
  bridge: {
    degraded:
      "Some recent Bridge logins failed. Calls may be slow or fail until it recovers. If it continues, check that Proton Bridge is running and signed in.",
    down: "Bridge logins are failing, so mail tools cannot reach the mailbox. Check that Proton Bridge is running and signed in, and that its exported certificate still matches.",
    unknown:
      "No Bridge login in the last 15 minutes. The probe runs every minute while no other mail operation is running.",
  },
  mcp: {
    degraded: "Some tool calls failed recently; see the incidents below.",
    down: "The MCP server is shutting down or not accepting calls.",
  },
  action_log: {
    down: "The action journal is not private or not writable, so mailbox writes are refused. Its directory and file must belong to the service account and not be readable by others.",
  },
  allowlist: {
    down: "The allowlist store cannot be read or has unsafe permissions, so every body read is refused. It must belong to the service account with mode 0600 in a private directory.",
  },
}

function HealthPage() {
  const range = Route.useSearch({ select: (s) => s.range ?? "24h" })
  const navigate = Route.useNavigate()
  const health = useQuery(healthQuery(range))
  const session = useQuery(sessionQuery)
  const grafana = session.data?.services?.find((s) => /grafana/i.test(s.name))
  const data = health.data
  return (
    <Page>
      <PageHeader>
        <div className="flex flex-col gap-1">
          <PageTitle>Health</PageTitle>
          {data ? (
            <PageMeta>
              <StateBadge state={data.state} />
              <time dateTime={data.checked_at}>
                Checked {formatRelative(data.checked_at)}
              </time>
            </PageMeta>
          ) : null}
        </div>
        <PageActions>
          {grafana ? (
            <Button
              variant="ghost"
              size="sm"
              render={<a href={grafana.url} target="_blank" rel="noreferrer" />}
              nativeButton={false}
            >
              {grafana.name}
              <ExternalLinkIcon data-icon="inline-end" />
            </Button>
          ) : null}
          <ChartRangeSelect
            value={range}
            ranges={RANGE_OPTIONS}
            onChange={(next) =>
              void navigate({
                search: next === "24h" ? {} : { range: next },
                replace: true,
              })
            }
          />
        </PageActions>
      </PageHeader>
      {health.isError ? (
        <QueryError
          title="Health could not be loaded"
          error={health.error}
          onRetry={() => void health.refetch()}
        />
      ) : !data ? (
        <>
          <Skeleton className="h-72 rounded-3xl" />
          <PageGrid layout="two">
            <Skeleton className="h-64 rounded-3xl" />
            <Skeleton className="h-64 rounded-3xl" />
          </PageGrid>
        </>
      ) : (
        <HealthCards data={data} range={range} />
      )}
    </Page>
  )
}

function HealthCards({ data, range }: { data: Health; range: Range }) {
  const problems = data.components.filter(
    (c) => c.state !== "ok" && EXPLAIN[c.id]?.[c.state]
  )
  const formatTime = bucketFormat(data.bucket_seconds)
  const measured = data.components.filter((c) => c.latency.length > 0)
  return (
    <>
      {problems.map((c) => (
        <Alert
          key={c.id}
          variant={c.state === "down" ? "destructive" : "default"}
        >
          <TriangleAlertIcon />
          <AlertTitle>
            {COMPONENT_LABELS[c.id] ?? c.name}:{" "}
            {STATE_LABELS[c.state].toLowerCase()}
          </AlertTitle>
          <AlertDescription>{EXPLAIN[c.id]![c.state]}</AlertDescription>
        </Alert>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {data.components.map((c) => {
            const known = c.timeline.filter((p) => p.state !== "unknown")
            const good = known.filter((p) => p.state === "ok").length
            return (
              <section key={c.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className="truncate">
                      {COMPONENT_LABELS[c.id] ?? c.name}
                    </span>
                    <StateBadge state={c.state} />
                  </h3>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {known.length
                      ? `${Math.round((good / known.length) * 1000) / 10}% of periods clear`
                      : "No data"}
                  </span>
                </div>
                <StatusTimeline
                  label={`${COMPONENT_LABELS[c.id] ?? c.name}, ${RANGE_WORDS[range]}`}
                  formatTime={formatTime}
                  points={c.timeline.map((p) => ({
                    time: Date.parse(p.start),
                    state: p.state,
                    detail:
                      p.ok + p.failed > 0
                        ? `${formatInteger(p.failed)} failed of ${formatInteger(p.ok + p.failed)} ${c.id === "mcp" ? "calls" : "checks"}`
                        : undefined,
                  }))}
                />
              </section>
            )
          })}
          <StatusLegend />
        </CardContent>
      </Card>
      {measured.length ? (
        <PageGrid layout="two" className="items-stretch">
          {measured.map((c) => (
            <LatencyCard key={c.id} component={c} />
          ))}
        </PageGrid>
      ) : null}
      <IncidentsCard data={data} range={range} />
      <PageGrid layout="two" className="items-stretch">
        <EnforcementCard enforcement={data.enforcement} />
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Release</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList>
              <DetailRow label="Version">{data.about.version}</DetailRow>
              <DetailRow label="Pinned release">
                {data.about.release ? (
                  <span className="flex items-center gap-1">
                    <span>{data.about.release.tag}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {data.about.release.commit.slice(0, 7)}
                    </span>
                    <CopyButton
                      value={data.about.release.commit}
                      label="Copy commit"
                    />
                  </span>
                ) : (
                  <Unavailable>Not recorded by the installer</Unavailable>
                )}
              </DetailRow>
              <DetailRow label="Last checked">
                <time dateTime={data.checked_at}>
                  {formatPrecise(data.checked_at)}
                </time>
              </DetailRow>
            </DetailList>
          </CardContent>
        </Card>
      </PageGrid>
    </>
  )
}

function LatencyCard({ component }: { component: HealthComponent }) {
  const label = COMPONENT_LABELS[component.id] ?? component.name
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{label} latency</CardTitle>
        <CardAction>
          <StateBadge state={component.state} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <LatencySparkline
          points={component.latency}
          label={`Recent ${label} latency`}
        />
        <DetailList>
          <DetailRow label="Latest">{formatMs(component.latency_ms)}</DetailRow>
          <DetailRow label="Median, 24 h">
            {formatMs(component.p50_ms)}
          </DetailRow>
          <DetailRow label="95th percentile, 24 h">
            {formatMs(component.p95_ms)}
          </DetailRow>
          <DetailRow label="Failures, 24 h">
            {component.failures.length ? (
              <span className="flex flex-wrap justify-end gap-1">
                {component.failures.map((f) => (
                  <span key={f.error_class} className="flex items-center gap-1">
                    <ErrorClassBadge errorClass={f.error_class} />
                    <span className="tabular-nums">×{f.count}</span>
                  </span>
                ))}
              </span>
            ) : (
              "None"
            )}
          </DetailRow>
          <DetailRow label="Last success">
            {component.last_success_at
              ? formatRelative(component.last_success_at)
              : "Never"}
          </DetailRow>
        </DetailList>
      </CardContent>
    </Card>
  )
}

const span = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})
const clock = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

function IncidentsCard({ data, range }: { data: Health; range: Range }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Incidents</CardTitle>
      </CardHeader>
      <CardContent>
        {data.incidents.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No failures in the {RANGE_WORDS[range]}
          </p>
        ) : (
          <ol className="-my-2 divide-y divide-border/70 text-sm">
            {data.incidents.map((incident) => {
              const start = Date.parse(incident.started_at)
              const end = Date.parse(incident.ended_at)
              return (
                <li
                  key={`${incident.component}-${incident.started_at}-${incident.error_class}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[14rem_minmax(0,1fr)_auto]"
                >
                  <time
                    dateTime={incident.started_at}
                    className="text-muted-foreground tabular-nums"
                  >
                    {span.format(start)}
                    {end - start >= 60_000 ? `–${clock.format(end)}` : ""}
                  </time>
                  <span className="font-medium max-sm:order-first max-sm:col-span-2">
                    {COMPONENT_LABELS[incident.component] ?? incident.component}
                  </span>
                  <span className="flex items-center justify-end gap-2">
                    <ErrorClassBadge errorClass={incident.error_class} />
                    {incident.count > 1 ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        ×{formatInteger(incident.count)}
                      </span>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function EnforcementCard({ enforcement }: { enforcement: Enforcement }) {
  const audit = enforcement.audit
  const auditBad =
    audit &&
    audit.counts.allowlisted_sender > 0 &&
    audit.counts.authenticated_allowlisted === 0
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Enforcement</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DetailList>
          <DetailRow label="Trusted authserv id">
            {enforcement.authserv_configured ? (
              <ToneBadge tone="good" label="Configured" />
            ) : (
              <ToneBadge tone="bad" label="Not configured" />
            )}
          </DetailRow>
          <DetailRow label="Allowlist store">
            {enforcement.store_ok ? (
              <ToneBadge tone="good" label="Readable, private" />
            ) : (
              <ToneBadge tone="bad" label="Unreadable or unsafe" />
            )}
          </DetailRow>
          <DetailRow label="Last header audit">
            {audit ? (
              <time dateTime={audit.time}>{formatRelative(audit.time)}</time>
            ) : (
              <Unavailable>None recorded</Unavailable>
            )}
          </DetailRow>
          {audit ? (
            <>
              <DetailRow label="Headers scanned">
                {formatInteger(audit.counts.scanned)} of{" "}
                {formatInteger(audit.counts.candidates)}
              </DetailRow>
              <DetailRow label="From allowed senders">
                {formatInteger(audit.counts.allowlisted_sender)}
              </DetailRow>
              <DetailRow label="Would pass verification">
                {formatInteger(audit.counts.authenticated_allowlisted)}
              </DetailRow>
              <DetailRow label="Would be refused">
                {formatInteger(audit.counts.unverified_allowlisted)}
              </DetailRow>
            </>
          ) : null}
        </DetailList>
        {!enforcement.authserv_configured ? (
          <p className="text-sm text-destructive">
            Without a trusted authserv id no sender can be verified, so every
            body read is refused.
          </p>
        ) : auditBad ? (
          <p className="text-sm text-destructive">
            No allowlisted message in the audit would pass verification. The
            trusted authserv id probably does not match the receiving server.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
