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
import { formatDateTime, formatRelative } from "@zsrobinson/shell/lib/format"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@zsrobinson/shell/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { PlusIcon, SearchIcon } from "lucide-react"
import { ExpiryBadge } from "@/components/badges"
import { formatDate, formatInteger, isExpired } from "@/lib/format"
import { allowlistQuery } from "@/lib/queries"
import type { AllowlistEntry } from "@/lib/types"

export const Route = createFileRoute("/allowlist/")({
  validateSearch: (search): { q?: string } =>
    typeof search.q === "string" && search.q
      ? { q: search.q.slice(0, 100) }
      : {},
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(allowlistQuery)
  },
  component: AllowlistPage,
})

function matches(entry: AllowlistEntry, query: string) {
  const q = query.trim().toLowerCase()
  return (
    !q ||
    entry.address.toLowerCase().includes(q) ||
    entry.note.toLowerCase().includes(q)
  )
}

function AllowlistPage() {
  const q = Route.useSearch({ select: (s) => s.q ?? "" })
  const navigate = Route.useNavigate()
  const allowlist = useQuery(allowlistQuery)
  const query = useDeferredValue(q)
  const entries = allowlist.data?.entries ?? []
  const shown = entries
    .filter((entry) => matches(entry, query))
    .toSorted((a, b) => a.address.localeCompare(b.address))
  const active = entries.filter((e) => !isExpired(e.expires_at)).length
  return (
    <Page>
      <PageHeader>
        <div className="flex flex-col gap-1">
          <PageTitle>Allowlist</PageTitle>
          {allowlist.data ? (
            <PageMeta>
              {query.trim() ? (
                <span>
                  {formatInteger(shown.length)} of{" "}
                  {formatInteger(entries.length)} match
                </span>
              ) : (
                <>
                  <span>{formatInteger(active)} active</span>
                  {entries.length > active ? (
                    <span>
                      {formatInteger(entries.length - active)} expired
                    </span>
                  ) : null}
                </>
              )}
            </PageMeta>
          ) : null}
        </div>
        <PageActions>
          <Button render={<Link to="/allowlist/new" />} nativeButton={false}>
            <PlusIcon data-icon="inline-start" />
            Add sender
          </Button>
        </PageActions>
      </PageHeader>
      <InputGroup className="w-full sm:max-w-sm">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Search addresses and notes"
          placeholder="Search addresses and notes"
          value={q}
          onChange={(e) =>
            void navigate({
              search: e.target.value ? { q: e.target.value } : {},
              replace: true,
            })
          }
        />
      </InputGroup>
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
              {entries.length ? "No senders match" : "No senders allowed"}
            </EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            {entries.length ? (
              <Button
                variant="outline"
                onClick={() => void navigate({ search: {}, replace: true })}
              >
                Clear search
              </Button>
            ) : (
              <Button
                render={<Link to="/allowlist/new" />}
                nativeButton={false}
              >
                Add sender
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Address</TableHead>
                <TableHead className="max-lg:hidden">Added</TableHead>
                <TableHead className="max-sm:hidden">Expires</TableHead>
                <TableHead className="max-md:hidden">Last matched</TableHead>
                <TableHead className="pr-5 text-right">Matches</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Page>
  )
}

function EntryRow({ entry }: { entry: AllowlistEntry }) {
  const expired = isExpired(entry.expires_at)
  return (
    <TableRow>
      <TableCell className="w-full max-w-0 pl-5 whitespace-normal">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/allowlist/$id"
            params={{ id: entry.id }}
            className="truncate font-medium underline-offset-4 hover:underline"
          >
            {entry.address}
          </Link>
          {expired ? <ExpiryBadge expiresAt={entry.expires_at} /> : null}
        </div>
        {entry.note ? (
          <div className="truncate text-xs text-muted-foreground">
            {entry.note}
          </div>
        ) : null}
        {entry.expires_at && !expired ? (
          <div className="text-xs text-muted-foreground sm:hidden">
            Until {formatDate(entry.expires_at)}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground max-lg:hidden">
        {formatDate(entry.added_at)}
      </TableCell>
      <TableCell className="whitespace-nowrap max-sm:hidden">
        {entry.expires_at ? (
          <span
            className={expired ? "text-muted-foreground" : undefined}
            title={formatDateTime(entry.expires_at)}
          >
            {formatDate(entry.expires_at)}
          </span>
        ) : (
          <span className="text-muted-foreground">Never</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground max-md:hidden">
        {entry.last_matched_at ? (
          <time
            dateTime={entry.last_matched_at}
            title={formatDateTime(entry.last_matched_at)}
          >
            {formatRelative(entry.last_matched_at)}
          </time>
        ) : (
          "Never"
        )}
      </TableCell>
      <TableCell className="pr-5 text-right font-medium tabular-nums">
        {formatInteger(entry.match_count)}
      </TableCell>
    </TableRow>
  )
}
