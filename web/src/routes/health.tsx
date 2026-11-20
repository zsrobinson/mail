import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  Page,
  PageGrid,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { LatencySparkline } from "@/components/charts"
import {
  DetailList,
  DetailRow,
  Unavailable,
} from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { formatDateTime, formatRelative } from "@zsrobinson/shell/lib/format"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@zsrobinson/shell/ui/card"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import { StateBadge } from "@/components/badges"
import { formatInteger, formatMs } from "@/lib/format"
import { healthQuery } from "@/lib/queries"
import type { HealthComponent } from "@/lib/types"

export const Route = createFileRoute("/health")({
  staticData: { crumb: "Health" },
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(healthQuery)
  },
  component: HealthPage,
})

function HealthPage() {
  const health = useQuery(healthQuery)
  return (
    <Page>
      <PageHeader>
        <div className="flex flex-col gap-1">
          <PageTitle>Health</PageTitle>
          {health.data ? (
            <PageMeta>
              <StateBadge state={health.data.state} />
              <span title={formatDateTime(health.data.checked_at)}>
                Updated {formatRelative(health.data.checked_at)}
              </span>
            </PageMeta>
          ) : null}
        </div>
      </PageHeader>
      {health.isError ? (
        <QueryError
          title="Health could not be loaded"
          error={health.error}
          onRetry={() => void health.refetch()}
        />
      ) : !health.data ? (
        <PageGrid layout="two">
          <Skeleton className="h-72 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </PageGrid>
      ) : (
        <PageGrid layout="two">
          {health.data.components.map((component) => (
            <ComponentCard key={component.id} component={component} />
          ))}
        </PageGrid>
      )}
    </Page>
  )
}

function ComponentCard({ component: c }: { component: HealthComponent }) {
  const measured = c.latency.length > 0
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{c.name}</CardTitle>
        <CardAction>
          <StateBadge state={c.state} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {measured ? (
          <LatencySparkline
            points={c.latency}
            label={`${c.name} recent latency`}
          />
        ) : null}
        <DetailList>
          {measured ? (
            <>
              <DetailRow label="Latest">{formatMs(c.latency_ms)}</DetailRow>
              <DetailRow label="Median, 24 h">{formatMs(c.p50_ms)}</DetailRow>
              <DetailRow label="95th percentile, 24 h">
                {formatMs(c.p95_ms)}
              </DetailRow>
            </>
          ) : null}
          <DetailRow label="Errors, 24 h">
            {formatInteger(c.errors_24h)}
          </DetailRow>
          <DetailRow label="Last success">
            {c.last_success_at ? (
              <span title={formatDateTime(c.last_success_at)}>
                {formatRelative(c.last_success_at)}
              </span>
            ) : (
              <Unavailable>Never</Unavailable>
            )}
          </DetailRow>
          {c.last_error_at ? (
            <DetailRow label="Last error">
              <span title={formatDateTime(c.last_error_at)}>
                {formatRelative(c.last_error_at)}
              </span>
            </DetailRow>
          ) : null}
          {c.failures.length ? (
            <DetailRow label="Failures by class">
              <span className="flex flex-wrap justify-end gap-1">
                {c.failures.map((failure) => (
                  <Badge key={failure.error_class} variant="outline">
                    <span className="font-mono">{failure.error_class}</span>
                    <span className="tabular-nums">
                      {formatInteger(failure.count)}
                    </span>
                  </Badge>
                ))}
              </span>
            </DetailRow>
          ) : null}
        </DetailList>
      </CardContent>
    </Card>
  )
}
