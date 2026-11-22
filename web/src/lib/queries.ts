import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { viewerTimeZone } from "@zsrobinson/shell/lib/calendar-date"
import { getJson } from "./api"
import type {
  Action,
  Activity,
  ActivityFilters,
  Allowlist,
  AllowlistDetail,
  CallDetail,
  Health,
  Overview,
  Range,
  Session,
} from "./types"

const LIVE = 30_000

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: ({ signal }) => getJson<Session>("/api/session", signal),
  retry: false,
  staleTime: 5 * 60_000,
})

const zoned = (range: Range) =>
  new URLSearchParams({ range, tz: viewerTimeZone() })

export const overviewQuery = (range: Range) =>
  queryOptions({
    queryKey: ["overview", range],
    queryFn: ({ signal }) =>
      getJson<Overview>(`/api/overview?${zoned(range)}`, signal),
    refetchInterval: LIVE,
    placeholderData: keepPreviousData,
  })

export function activityParams(filters: ActivityFilters) {
  const params = new URLSearchParams()
  if (filters.q?.trim()) params.set("q", filters.q.trim())
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  if (filters.tools?.length) params.set("tool", filters.tools.join(","))
  if (filters.outcomes?.length)
    params.set("outcome", filters.outcomes.join(","))
  if (filters.refusals) params.set("refusals", "1")
  if (filters.offset) params.set("offset", String(filters.offset))
  if (filters.limit) params.set("limit", String(filters.limit))
  params.set("tz", filters.tz ?? viewerTimeZone())
  return params
}

export const activityQuery = (filters: ActivityFilters) =>
  queryOptions({
    queryKey: ["activity", activityParams(filters).toString()],
    queryFn: ({ signal }) =>
      getJson<Activity>(`/api/activity?${activityParams(filters)}`, signal),
    refetchInterval: LIVE,
    placeholderData: keepPreviousData,
  })

export const callQuery = (id: string) =>
  queryOptions({
    queryKey: ["call", id],
    queryFn: ({ signal }) =>
      getJson<CallDetail>(`/api/activity/${encodeURIComponent(id)}`, signal),
  })

export const actionQuery = (id: string) =>
  queryOptions({
    queryKey: ["action", id],
    queryFn: ({ signal }) =>
      getJson<Action>(`/api/actions/${encodeURIComponent(id)}`, signal),
  })

export const allowlistQuery = queryOptions({
  queryKey: ["allowlist"],
  queryFn: ({ signal }) => getJson<Allowlist>("/api/allowlist", signal),
})

export const allowlistEntryQuery = (id: string) =>
  queryOptions({
    queryKey: ["allowlist", id],
    queryFn: ({ signal }) =>
      getJson<AllowlistDetail>(
        `/api/allowlist/${encodeURIComponent(id)}`,
        signal
      ),
  })

export const healthQuery = (range: Range) =>
  queryOptions({
    queryKey: ["health", range],
    queryFn: ({ signal }) =>
      getJson<Health>(`/api/health?${zoned(range)}`, signal),
    refetchInterval: LIVE,
    placeholderData: keepPreviousData,
  })

/** Recent write actions for the command palette: newest first, ids only. */
export const recentWritesQuery = queryOptions({
  queryKey: [
    "activity",
    "palette",
    "archive_messages,unarchive_messages,move_messages,add_labels,mark_read,create_draft",
  ],
  queryFn: ({ signal }) =>
    getJson<Activity>(
      `/api/activity?${activityParams({
        tools: [
          "archive_messages",
          "unarchive_messages",
          "move_messages",
          "add_labels",
          "mark_read",
          "create_draft",
        ],
        limit: 100,
      })}`,
      signal
    ),
  staleTime: 60_000,
})
