import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { CopyButton } from "@zsrobinson/shell/blocks/copy-button"
import {
  DetailList,
  DetailRow,
  Unavailable,
} from "@zsrobinson/shell/blocks/detail-list"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { ArrowRightIcon } from "lucide-react"
import {
  ErrorClassBadge,
  OutcomeBadge,
  RefusalBadge,
  StatusBadge,
} from "@/components/badges"
import { UnarchiveCard } from "@/components/unarchive-card"
import { ApiError } from "@/lib/api"
import {
  callSummary,
  ERROR_INFO,
  formatInteger,
  formatMs,
  formatPrecise,
  REFUSAL_DESCRIPTIONS,
  refusalTotal,
  shortId,
  TOOL_LABELS,
} from "@/lib/format"
import { callQuery } from "@/lib/queries"
import {
  REFUSAL_REASONS,
  type Action,
  type ActivityRow,
  type Tool,
} from "@/lib/types"

export const Route = createFileRoute("/activity/$id")({
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(callQuery(params.id))
  },
  component: CallPage,
})

function CallPage() {
  const { id } = Route.useParams()
  const detail = useQuery(callQuery(id))
  if (detail.isError)
    return (
      <Page>
        <PageHeader>
          <PageTitle>Call</PageTitle>
        </PageHeader>
        <QueryError
          title={
            detail.error instanceof ApiError && detail.error.status === 404
              ? "This call is not in the activity log"
              : "Call could not be loaded"
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
          <Skeleton className="h-8 w-56" />
        </PageHeader>
        <PageGrid layout="two">
          <Skeleton className="h-72 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </PageGrid>
      </Page>
    )
  const { call, action } = detail.data
  const summary = callSummary(call)
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <PageTitle>{TOOL_LABELS[call.tool]}</PageTitle>
          <PageMeta>
            <OutcomeBadge outcome={call.outcome} />
            <time dateTime={call.time}>{formatPrecise(call.time)}</time>
            {summary ? <span className="tabular-nums">{summary}</span> : null}
          </PageMeta>
        </div>
        <PageActions>
          <Button
            variant="ghost"
            size="sm"
            render={
              <Link to="/activity" search={{ tool: call.tool as string }} />
            }
            nativeButton={false}
          >
            More {TOOL_LABELS[call.tool].toLowerCase()} calls
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </PageActions>
      </PageHeader>
      <PageGrid layout="two" className="items-stretch">
        <TimingCard call={call} />
        <CountsCard call={call} />
      </PageGrid>
      {refusalTotal(call.counts) > 0 ? <RefusalsCard call={call} /> : null}
      {call.error_class ? <ErrorCard call={call} /> : null}
      {action ? (
        <PageGrid
          layout={action.unarchive ? "two" : "one"}
          className="items-stretch"
        >
          <BatchCard action={action} />
          {action.unarchive ? <UnarchiveCard action={action} /> : null}
        </PageGrid>
      ) : null}
      {action && action.chunks.length > 1 ? (
        <ChunksCard action={action} />
      ) : null}
    </Page>
  )
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <DetailRow label={label}>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-xs">{value}</span>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </span>
    </DetailRow>
  )
}

function TimingCard({ call }: { call: ActivityRow }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Call</CardTitle>
      </CardHeader>
      <CardContent>
        <DetailList>
          <DetailRow label="When">
            <time dateTime={call.time}>{formatRelative(call.time)}</time>
          </DetailRow>
          <DetailRow label="Total time">{formatMs(call.duration_ms)}</DetailRow>
          <DetailRow label="Bridge login">
            {call.login_ms ? (
              formatMs(call.login_ms)
            ) : (
              <Unavailable>Not needed</Unavailable>
            )}
          </DetailRow>
          {call.dry_run ? (
            <DetailRow label="Mode">Preview; nothing changed</DetailRow>
          ) : null}
          <IdRow label="Call id" value={call.id} />
          {call.action_id ? (
            <IdRow label="Action id" value={call.action_id} />
          ) : null}
        </DetailList>
      </CardContent>
    </Card>
  )
}

const WRITE_COUNT: Partial<
  Record<Tool, [string, keyof ActivityRow["counts"]]>
> = {
  archive_messages: ["Archived", "moved"],
  unarchive_messages: ["Moved to INBOX", "moved"],
  move_messages: ["Moved", "moved"],
  add_labels: ["Labelled", "labelled"],
  mark_read: ["Marked read", "marked"],
  create_draft: ["Drafts saved", "drafts"],
}

function CountsCard({ call }: { call: ActivityRow }) {
  const c = call.counts
  const write = WRITE_COUNT[call.tool]
  const reads = call.tool === "read_messages"
  const returnedLabel = reads
    ? "Bodies returned"
    : call.tool === "list_unsubscribe"
      ? "Headers returned"
      : "Results returned"
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Messages</CardTitle>
      </CardHeader>
      <CardContent>
        <DetailList>
          <DetailRow label={reads || write ? "Requested" : "Limit"}>
            {c.requested ? (
              formatInteger(c.requested)
            ) : (
              <Unavailable>None</Unavailable>
            )}
          </DetailRow>
          {write ? (
            <DetailRow label={write[0]}>
              {formatInteger(c[write[1]] as number)}
            </DetailRow>
          ) : (
            <DetailRow label={returnedLabel}>
              {formatInteger(c.returned)}
            </DetailRow>
          )}
          {reads ? (
            <DetailRow label="Bodies refused">
              {formatInteger(refusalTotal(c))}
            </DetailRow>
          ) : null}
        </DetailList>
      </CardContent>
    </Card>
  )
}

function RefusalsCard({ call }: { call: ActivityRow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Refused bodies</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="-my-2 divide-y divide-border/70 text-sm">
          {REFUSAL_REASONS.filter((r) => call.counts.refused[r] > 0).map(
            (reason) => (
              <li
                key={reason}
                className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <RefusalBadge reason={reason} />
                  <p className="text-muted-foreground">
                    {REFUSAL_DESCRIPTIONS[reason]}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {reason}
                  </p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatInteger(call.counts.refused[reason])}{" "}
                  {call.counts.refused[reason] === 1 ? "message" : "messages"}
                </span>
              </li>
            )
          )}
        </ul>
      </CardContent>
      {call.counts.refused.sender_not_allowlisted ? (
        <CardContent className="pt-0">
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/allowlist" />}
            nativeButton={false}
          >
            Review the allowlist
          </Button>
        </CardContent>
      ) : null}
    </Card>
  )
}

const ERROR_HINTS: Record<string, string> = {
  deadline:
    "Narrow the date range or folder for searches. For writes, check the action's chunks below before retrying.",
  stopped:
    "Check which chunks completed below; search the mailbox before retrying the rest.",
  OSError: "Check Bridge on the Health page.",
  TimeoutError: "Check Bridge on the Health page.",
  busy: "Nothing changed. The agent can retry once the other operation finishes.",
}

function ErrorCard({ call }: { call: ActivityRow }) {
  const errorClass = call.error_class!
  const info = ERROR_INFO[errorClass]
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {call.outcome === "busy" ? "Turned away" : "Error"}
        </CardTitle>
        {errorClass === "OSError" || errorClass === "TimeoutError" ? (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/health" />}
              nativeButton={false}
            >
              Health <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div>
          <ErrorClassBadge errorClass={errorClass} />
        </div>
        <p>
          {info?.description ?? "The server recorded only this error class."}
        </p>
        {ERROR_HINTS[errorClass] ? (
          <p className="text-muted-foreground">{ERROR_HINTS[errorClass]}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function BatchCard({ action }: { action: Action }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Batch</CardTitle>
        <CardAction>
          <StatusBadge status={action.status} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DetailList>
          <DetailRow label="Requested">
            {formatInteger(action.counts.requested)}
          </DetailRow>
          <DetailRow label="Completed">
            {formatInteger(action.counts.completed)}
          </DetailRow>
          {action.counts.uncertain ? (
            <DetailRow label="Uncertain">
              {formatInteger(action.counts.uncertain)}
            </DetailRow>
          ) : null}
          {action.counts.failed ? (
            <DetailRow label="Not done">
              {formatInteger(action.counts.failed)}
            </DetailRow>
          ) : null}
          <DetailRow label="Chunks">
            {formatInteger(action.chunks.length)}
          </DetailRow>
          {action.source_action_id ? (
            <DetailRow label="Restores">
              <Link
                to="/actions/$id"
                params={{ id: action.source_action_id }}
                className="font-mono text-xs underline underline-offset-4"
              >
                Archive {shortId(action.source_action_id)}
              </Link>
            </DetailRow>
          ) : null}
          {action.unarchive?.restored_by ? (
            <DetailRow label="Restored by">
              <Link
                to="/actions/$id"
                params={{ id: action.unarchive.restored_by }}
                className="font-mono text-xs underline underline-offset-4"
              >
                Unarchive {shortId(action.unarchive.restored_by)}
              </Link>
            </DetailRow>
          ) : null}
        </DetailList>
      </CardContent>
    </Card>
  )
}

function ChunksCard({ action }: { action: Action }) {
  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle>Chunks</CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Chunk</TableHead>
            <TableHead className="text-right">Messages</TableHead>
            <TableHead className="pr-5 text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {action.chunks.map((chunk) => (
            <TableRow key={chunk.index}>
              <TableCell className="w-full pl-5 tabular-nums">
                {chunk.index + 1}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInteger(chunk.size)}
              </TableCell>
              <TableCell className="pr-5 text-right">
                <StatusBadge status={chunk.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
