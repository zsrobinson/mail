import { useEffect, useState } from "react"
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
  TrendChart,
  type ChartRangeOption,
} from "@zsrobinson/shell/blocks/chart-card"
import { EmptyList } from "@zsrobinson/shell/blocks/list-row"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Stat, StatRow } from "@zsrobinson/shell/blocks/stat"
import { formatCalendarDate } from "@zsrobinson/shell/lib/calendar-date"
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
import { CalendarClockIcon, Trash2Icon } from "lucide-react"
import { EntryStateBadge } from "@/components/badges"
import {
  endOfDayLabel,
  EXPIRY_PRESETS,
  SenderFields,
  senderErrors,
  senderInput,
  type SenderDraft,
} from "@/components/sender-fields"
import { ApiError } from "@/lib/api"
import {
  CHANGE_LABELS,
  entryState,
  formatDate,
  formatInteger,
} from "@/lib/format"
import {
  useRemoveSender,
  useRestoreSender,
  useUpdateSender,
} from "@/lib/mutations"
import { allowlistEntryQuery } from "@/lib/queries"
import type { AllowlistEntry, HistoryItem } from "@/lib/types"
import { dateFromExpiry, expiryFromDate } from "@/lib/validation"

export const Route = createFileRoute("/allowlist/$id")({
  validateSearch: (search): { focus?: "expiry" } =>
    search.focus === "expiry" ? { focus: "expiry" } : {},
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(allowlistEntryQuery(params.id))
  },
  component: EntryPage,
})

function EntryPage() {
  const { id } = Route.useParams()
  const focus = Route.useSearch({ select: (s) => s.focus })
  const detail = useQuery(allowlistEntryQuery(id))
  const loaded = Boolean(detail.data)
  // Extend and Renew links land on the expiry choice, ready for the keyboard.
  useEffect(() => {
    if (focus !== "expiry" || !loaded) return
    const target =
      document.querySelector<HTMLElement>("[data-renew-primary]") ??
      document.querySelector<HTMLElement>('[id$="-until"]')
    target?.scrollIntoView({ block: "center" })
    target?.focus({ preventScroll: true })
  }, [focus, loaded])
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
  const state = entryState(entry.expires_at)
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <PageTitle className="break-all">{entry.address}</PageTitle>
          <PageMeta>
            <EntryStateBadge state={state} />
            <span>Added {formatDate(entry.added_at)}</span>
            <span>
              {entry.expires_at
                ? `${state === "expired" ? "Ended" : "Until"} ${formatDateTime(entry.expires_at)}`
                : "No end date"}
            </span>
          </PageMeta>
        </div>
        <PageActions>
          <RemoveSender entry={entry} />
        </PageActions>
      </PageHeader>
      {state !== "active" ? <RenewCard entry={entry} /> : null}
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

/** Extend an entry that is about to end, or renew one that has. */
function RenewCard({ entry }: { entry: AllowlistEntry }) {
  const update = useUpdateSender(entry.id)
  const expired = entryState(entry.expires_at) === "expired"
  const [choice, setChoice] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClockIcon className="size-4 text-chart-3" />
          {expired ? "Renew access" : "Extend access"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          {expired ? "Access ended" : "Access ends"}{" "}
          {formatRelative(entry.expires_at!)}, on{" "}
          {formatDateTime(entry.expires_at!)}.{" "}
          {expired
            ? "Bodies from this sender are refused until it is renewed."
            : "After that, bodies from this sender are refused."}
        </p>
        <div className="flex flex-wrap gap-2">
          {EXPIRY_PRESETS().map((preset) => (
            <Button
              key={preset.label}
              variant={preset.label === "30 days" ? "default" : "outline"}
              data-renew-primary={preset.label === "30 days" ? "" : undefined}
              size="sm"
              disabled={update.isPending}
              onClick={() => {
                setChoice(preset.label)
                update.mutate({
                  expires_at: expiryFromDate(preset.value) ?? null,
                  success: preset.value
                    ? `Allowed until ${formatCalendarDate(preset.value)}`
                    : "Allowed with no end date",
                })
              }}
            >
              {update.isPending && choice === preset.label ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {preset.value
                ? `${preset.label} · ${formatCalendarDate(preset.value)}`
                : preset.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          New end times are {endOfDayLabel(EXPIRY_PRESETS()[0].value)} on the
          chosen day. Pick any other date under Edit.
        </p>
      </CardContent>
    </Card>
  )
}

const MATCH_RANGES: ChartRangeOption<"30" | "90" | "366">[] = [
  { value: "30", label: "Last 30 days", duration: 30 * 86_400 },
  { value: "90", label: "Last 90 days", duration: 90 * 86_400 },
  { value: "366", label: "Last year", duration: 366 * 86_400 },
]
const matchConfig = { count: { label: "Matches", color: "var(--chart-1)" } }
const utcDay = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

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
      <CardContent className="flex flex-col gap-5">
        <StatRow>
          <Stat label="In range">{formatInteger(total)}</Stat>
          <Stat label="All time">{formatInteger(entry.match_count)}</Stat>
          <Stat label="Last matched">
            <span className="text-base font-medium">
              {entry.last_matched_at
                ? formatRelative(entry.last_matched_at)
                : "Never"}
            </span>
          </Stat>
        </StatRow>
        {total === 0 ? (
          <p className="flex h-32 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
            No bodies returned for this sender in this range
          </p>
        ) : (
          <TrendChart
            integer
            kind="bar"
            utc
            data={series.map((m) => ({
              time: Date.parse(`${m.date}T00:00:00Z`),
              count: m.count,
            }))}
            config={matchConfig}
            formatTime={(time) => utcDay.format(time)}
            label="Bodies returned for this sender per day"
            className="h-44"
          />
        )}
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

/**
 * Removal is immediate and undoable: the core keeps the entry, its matches
 * and its history, and the toast's Undo restores exactly that entry.
 */
function RemoveSender({ entry }: { entry: AllowlistEntry }) {
  const navigate = useNavigate()
  const remove = useRemoveSender(entry.id)
  const restore = useRestoreSender()
  return (
    <Button
      variant="outline"
      disabled={remove.isPending}
      onClick={() =>
        remove.mutate(undefined, {
          onSuccess: () => {
            void navigate({ to: "/allowlist" })
            toast.success(`Removed ${entry.address}`, {
              description: "Bodies from this address are refused again.",
              duration: 10_000,
              action: {
                label: "Undo",
                onClick: () =>
                  restore.mutate(entry.id, {
                    onSuccess: () =>
                      void navigate({
                        to: "/allowlist/$id",
                        params: { id: entry.id },
                      }),
                  }),
              },
            })
          },
        })
      }
    >
      {remove.isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Trash2Icon data-icon="inline-start" />
      )}
      Remove
    </Button>
  )
}
