import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageGrid,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { CopyButton } from "@zsrobinson/shell/blocks/copy-button"
import { DetailList, DetailRow } from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { formatDateTime, formatRelative } from "@zsrobinson/shell/lib/format"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@zsrobinson/shell/ui/card"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import { Spinner } from "@zsrobinson/shell/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { StatusBadge } from "@/components/badges"
import { ApiError } from "@/lib/api"
import { formatInteger, KIND_LABELS } from "@/lib/format"
import { useConfirmUnarchive, usePreviewUnarchive } from "@/lib/mutations"
import { actionQuery } from "@/lib/queries"
import type { Action, UnarchivePreview } from "@/lib/types"

export const Route = createFileRoute("/actions/$id")({
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(actionQuery(params.id))
  },
  component: ActionPage,
})

function ActionPage() {
  const { id } = Route.useParams()
  const action = useQuery(actionQuery(id))
  if (action.isError)
    return (
      <Page>
        <PageHeader>
          <PageTitle>Action</PageTitle>
        </PageHeader>
        <QueryError
          title={
            action.error instanceof ApiError && action.error.status === 404
              ? "This action is not in the history"
              : "Action could not be loaded"
          }
          error={action.error}
          onRetry={() => void action.refetch()}
        />
      </Page>
    )
  if (!action.data)
    return (
      <Page>
        <PageHeader>
          <Skeleton className="h-8 w-48" />
        </PageHeader>
        <Skeleton className="h-56 rounded-3xl" />
      </Page>
    )
  const data = action.data
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <PageTitle>{KIND_LABELS[data.kind]} action</PageTitle>
          <PageMeta>
            <StatusBadge status={data.status} />
            <time dateTime={data.time} title={formatDateTime(data.time)}>
              {formatDateTime(data.time)}
            </time>
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-xs">{data.id}</span>
              <CopyButton value={data.id} label="Copy action id" />
            </span>
          </PageMeta>
        </div>
      </PageHeader>
      <PageGrid
        layout={data.unarchive ? "two" : "one"}
        className="items-stretch"
      >
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Messages</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList>
              <DetailRow label="Requested">
                {formatInteger(data.counts.requested)}
              </DetailRow>
              <DetailRow label="Completed">
                {formatInteger(data.counts.completed)}
              </DetailRow>
              <DetailRow label="Uncertain">
                {formatInteger(data.counts.uncertain)}
              </DetailRow>
              <DetailRow label="Failed">
                {formatInteger(data.counts.failed)}
              </DetailRow>
              {data.dry_run ? (
                <DetailRow label="Mode">Dry run, nothing changed</DetailRow>
              ) : null}
            </DetailList>
          </CardContent>
        </Card>
        {data.unarchive ? <UnarchiveCard action={data} /> : null}
      </PageGrid>
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
            {data.chunks.map((chunk) => (
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
    </Page>
  )
}

function UnarchiveCard({ action }: { action: Action }) {
  const navigate = useNavigate()
  const unarchive = action.unarchive!
  const preview = usePreviewUnarchive(action.id)
  const confirm = useConfirmUnarchive(action.id)
  const [pending, setPending] = useState<UnarchivePreview | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Unarchive</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {unarchive.restored_by ? (
          <p>
            Already moved back to INBOX by{" "}
            <Link
              to="/actions/$id"
              params={{ id: unarchive.restored_by }}
              className="font-medium underline underline-offset-4"
            >
              a later unarchive
            </Link>
            .
          </p>
        ) : !unarchive.eligible ? (
          <p className="text-muted-foreground">
            {unarchive.reason ?? "This action cannot be unarchived."}
          </p>
        ) : pending ? (
          <DetailList>
            <DetailRow label="Messages to move">
              {formatInteger(pending.messages)}
            </DetailRow>
            <DetailRow label="From">Archive</DetailRow>
            <DetailRow label="To">INBOX</DetailRow>
            <DetailRow label="Chunks">
              {formatInteger(pending.chunks)}
            </DetailRow>
            <DetailRow label="Preview expires">
              {formatRelative(pending.expires_at)}
            </DetailRow>
          </DetailList>
        ) : (
          <p className="text-muted-foreground">
            Moves the {formatInteger(action.counts.completed)} archived messages
            from Archive back to INBOX. The preview checks the mailbox and
            changes nothing.
          </p>
        )}
      </CardContent>
      {unarchive.eligible && !unarchive.restored_by ? (
        <CardFooter className="mt-auto flex flex-wrap gap-2">
          {pending ? (
            <>
              <Button onClick={() => setOpen(true)}>
                Unarchive {formatInteger(pending.messages)} messages
              </Button>
              <Button variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              disabled={preview.isPending}
              onClick={() =>
                preview.mutate(undefined, { onSuccess: setPending })
              }
            >
              {preview.isPending ? <Spinner data-icon="inline-start" /> : null}
              Preview unarchive
            </Button>
          )}
        </CardFooter>
      ) : null}
      <ConfirmAction
        open={open}
        onOpenChange={setOpen}
        title={`Unarchive ${formatInteger(pending?.messages ?? 0)} messages?`}
        confirmLabel="Unarchive"
        onConfirm={async () => {
          if (!pending) return
          const result = await confirm.mutateAsync(pending.preview_token)
          setPending(null)
          void navigate({
            to: "/actions/$id",
            params: { id: result.action_id },
          })
        }}
      >
        They move from Archive to INBOX. Nothing is sent or deleted.
      </ConfirmAction>
    </Card>
  )
}
