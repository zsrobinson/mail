import { queryOptions } from "@tanstack/react-query"
import { getJson } from "./api"
import type {
  Action,
  Activity,
  Allowlist,
  AllowlistDetail,
  Health,
  Outcome,
  Overview,
  Range,
  Session,
  Tool,
} from "./types"

const LIVE = 30_000

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: ({ signal }) => getJson<Session>("/api/session", signal),
  retry: false,
  staleTime: 5 * 60_000,
})

export const overviewQuery = (range: Range) =>
  queryOptions({
    queryKey: ["overview", range],
    queryFn: ({ signal }) =>
      getJson<Overview>(`/api/overview?range=${range}`, signal),
    refetchInterval: LIVE,
    placeholderData: (previous) => previous,
  })

export const activityQuery = (filters: { tool?: Tool; outcome?: Outcome }) =>
  queryOptions({
    queryKey: ["activity", filters.tool ?? "", filters.outcome ?? ""],
    queryFn: ({ signal }) =>
      getJson<Activity>(
        `/api/activity?${new URLSearchParams({
          tool: filters.tool ?? "",
          outcome: filters.outcome ?? "",
        })}`,
        signal
      ),
    refetchInterval: LIVE,
    placeholderData: (previous) => previous,
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

export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: ({ signal }) => getJson<Health>("/api/health", signal),
  refetchInterval: LIVE,
})
