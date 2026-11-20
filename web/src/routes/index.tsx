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
  TrendChart,
  type ChartRangeOption,
} from "@zsrobinson/shell/blocks/chart-card"
import { DetailList, DetailRow } from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
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
import { ChevronRightIcon } from "lucide-react"
import { StateBadge } from "@/components/badges"
import { CategoryBars, StackedBars } from "@/components/charts"
import { Totals } from "@/components/totals"
import { epoch, formatInteger, formatMs, KIND_LABELS } from "@/lib/format"
import { overviewQuery } from "@/lib/queries"
import { RANGES, type Overview, type Range } from "@/lib/types"

const RANGE_OPTIONS: ChartRangeOption<Range>[] = [
  { value: "24h", label: "Last 24 hours", duration: 86_400 },
  { value: "7d", label: "Last 7 days", duration: 604_800 },
  { value: "30d", label: "Last 30 days", duration: 2_592_000 },
]

export const Route = createFileRoute("/")({
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

const callsConfig = {
  ok: { label: "Ok", color: "var(--chart-1)" },
  error: { label: "Not ok", color: "var(--chart-3)" },
}
const readsConfig = {
  allowed: { label: "Returned", color: "var(--chart-1)" },
  refused: { label: "Refused", color: "var(--chart-3)" },
}
const writesConfig = { value: { label: "Messages", color: "var(--chart-1)" } }
const latencyConfig = { ms: { label: "Login", color: "var(--chart-1)" } }

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
        <OverviewCards data={overview.data} />
      ) : (
        <OverviewSkeleton />
      )}
    </Page>
  )
}

function OverviewCards({ data }: { data: Overview }) {
  const writes = data.writes_by_kind.map((w) => ({
    name: KIND_LABELS[w.kind],
    value: w.messages,
    detail: `${formatInteger(w.messages)} messages in ${formatInteger(w.calls)} calls`,
  }))
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Calls</CardTitle>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/activity" />}
              nativeButton={false}
            >
              Activity <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Totals
            items={[
              ["Total", data.totals.calls],
              ["Not ok", data.totals.errors],
              ["Writes", data.totals.writes],
            ]}
          />
          <StackedBars
            rows={data.calls}
            config={callsConfig}
            bucketSeconds={data.bucket_seconds}
            label="Tool calls per period, ok and not ok"
          />
        </CardContent>
      </Card>
      <PageGrid layout="two" className="items-stretch">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Body reads</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Totals
              items={[
                ["Returned", data.totals.body_reads_allowed],
                ["Refused", data.totals.body_reads_refused],
              ]}
            />
            <StackedBars
              rows={data.body_reads}
              config={readsConfig}
              bucketSeconds={data.bucket_seconds}
              label="Message bodies returned and refused per period"
              height="h-44"
            />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Writes by kind</CardTitle>
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
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/health" />}
              nativeButton={false}
            >
              Health <ChevronRightIcon data-icon="inline-end" />
            </Button>
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
          <TrendChart
            data={data.bridge.latency.map((p) => ({
              time: epoch(p.time),
              ms: p.ms,
            }))}
            config={latencyConfig}
            label="Recent Bridge login latency"
            format={(value) => formatMs(value)}
            sparkline
          />
        </CardContent>
      </Card>
    </>
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
