import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageHeader,
  PageMeta,
  PageTitle,
  toast,
} from "@zsrobinson/shell"
import {
  ChartRangeSelect,
  type ChartRangeOption,
} from "@zsrobinson/shell/blocks/chart-card"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { EmptyList } from "@zsrobinson/shell/blocks/list-row"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { formatDateTime, formatRelative } from "@zsrobinson/shell/lib/format"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@zsrobinson/shell/ui/card"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import { Spinner } from "@zsrobinson/shell/ui/spinner"
import { ExpiryBadge } from "@/components/badges"
import {
  SenderFields,
  senderErrors,
  senderInput,
  type SenderDraft,
} from "@/components/sender-fields"
import { StackedBars } from "@/components/charts"
import { Totals } from "@/components/totals"
import { ApiError } from "@/lib/api"
import { CHANGE_LABELS, formatDate } from "@/lib/format"
import { useRemoveSender, useUpdateSender } from "@/lib/mutations"
import { allowlistEntryQuery } from "@/lib/queries"
import type { AllowlistEntry, HistoryItem } from "@/lib/types"
import { dateFromExpiry } from "@/lib/validation"

export const Route = createFileRoute("/allowlist/$id")({
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(allowlistEntryQuery(params.id))
  },
  component: EntryPage,
})

function EntryPage() {
  const { id } = Route.useParams()
  const detail = useQuery(allowlistEntryQuery(id))
  if (detail.isError)
    return (
      <Page>
        <PageHeader>
          <PageTitle>Sender</PageTitle>
        </PageHeader>
        <QueryError
          title={
            detail.error instanceof ApiError && detail.error.status === 404
              ? "This sender is not on the allowlist"
              : "Sender could not be loaded"
          }
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      </Page>
    )
  if (!detail.data)
    return (
      <Page>
        <PageHeader>
          <Skeleton className="h-8 w-64" />
        </PageHeader>
        <Skeleton className="h-80 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </Page>
    )
  const { entry, history } = detail.data
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <PageTitle className="break-all">{entry.address}</PageTitle>
          <PageMeta>
            <ExpiryBadge expiresAt={entry.expires_at} />
            <span>Added {formatDate(entry.added_at)}</span>
            {entry.expires_at ? (
              <span>Until {formatDate(entry.expires_at)}</span>
            ) : null}
          </PageMeta>
        </div>
        <PageActions>
          <RemoveSender entry={entry} />
        </PageActions>
      </PageHeader>
      <MatchesCard entry={entry} />
      {/* Remount on save so the form starts from the stored values. */}
      <EditCard
        key={`${entry.address}|${entry.note}|${entry.expires_at}`}
        entry={entry}
      />
      <ChangesCard history={history} />
    </Page>
  )
}

const MATCH_RANGES: ChartRangeOption<"30" | "90" | "366">[] = [
  { value: "30", label: "Last 30 days", duration: 30 * 86_400 },
  { value: "90", label: "Last 90 days", duration: 90 * 86_400 },
  { value: "366", label: "Last year", duration: 366 * 86_400 },
]
const matchConfig = { count: { label: "Matches", color: "var(--chart-1)" } }

function MatchesCard({ entry }: { entry: AllowlistEntry }) {
  const [days, setDays] = useState<"30" | "90" | "366">("30")
  const series = entry.matches.slice(-Number(days))
  const total = series.reduce((sum, m) => sum + m.count, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Matches</CardTitle>
        <CardAction>
          <ChartRangeSelect
            value={days}
            onChange={setDays}
            ranges={MATCH_RANGES}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Totals
          items={[
            ["In range", total],
            ["All time", entry.match_count],
          ]}
        />
        <StackedBars
          rows={series.map((m) => ({
            start: `${m.date}T00:00:00Z`,
            count: m.count,
          }))}
          config={matchConfig}
          bucketSeconds={86_400}
          label="Body reads allowed by this entry per day"
        />
        <p className="text-sm text-muted-foreground">
          {entry.last_matched_at
            ? `Last matched ${formatRelative(entry.last_matched_at)}`
            : "Not matched yet"}
        </p>
      </CardContent>
    </Card>
  )
}

function EditCard({ entry }: { entry: AllowlistEntry }) {
  const update = useUpdateSender(entry.id)
  const initial: SenderDraft = {
    address: entry.address,
    note: entry.note,
    until: dateFromExpiry(entry.expires_at),
  }
  const [draft, setDraft] = useState(initial)
  const [submitted, setSubmitted] = useState(false)
  const input = senderInput(draft)
  const changes = {
    ...(input.address !== entry.address ? { address: input.address } : {}),
    ...(input.note !== entry.note ? { note: input.note } : {}),
    ...(draft.until !== initial.until ? { expires_at: input.expires_at } : {}),
  }
  const dirty = Object.keys(changes).length > 0
  const valid = Object.values(senderErrors(draft)).every((e) => !e)
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
        if (!dirty || !valid || update.isPending) return
        update.mutate(changes)
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Edit</CardTitle>
        </CardHeader>
        <CardContent className="max-w-3xl">
          <SenderFields
            draft={draft}
            onChange={setDraft}
            showErrors={submitted}
          />
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!dirty || update.isPending}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Save changes
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft(initial)
                setSubmitted(false)
              }}
            >
              Discard
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </form>
  )
}

function ChangesCard({ history }: { history: HistoryItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit history</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <EmptyList>No changes recorded</EmptyList>
        ) : (
          <ol className="-my-2 divide-y divide-border/70 text-sm">
            {history.map((item, index) => (
              <li
                key={`${item.time}-${index}`}
                className="flex min-h-11 items-center justify-between gap-4 py-2 sm:min-h-9"
              >
                <span className="font-medium">
                  {CHANGE_LABELS[item.change] ?? item.change}
                </span>
                <time
                  dateTime={item.time}
                  className="text-right text-muted-foreground tabular-nums"
                >
                  {formatDateTime(item.time)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function RemoveSender({ entry }: { entry: AllowlistEntry }) {
  const navigate = useNavigate()
  const remove = useRemoveSender(entry.id)
  return (
    <ConfirmAction
      trigger={<Button variant="outline">Remove</Button>}
      title={`Remove ${entry.address}?`}
      confirmLabel="Remove"
      destructive
      onConfirm={async () => {
        await remove.mutateAsync()
        toast.success(`Removed ${entry.address}`)
        void navigate({ to: "/allowlist" })
      }}
    >
      Message bodies from this address will be refused again. Its history stays
      in the action log.
    </ConfirmAction>
  )
}
