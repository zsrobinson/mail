import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import { ApiError } from "@/lib/api"
import { actionQuery } from "@/lib/queries"

/** Old action links: open the call that made the action. */
export const Route = createFileRoute("/actions/$id")({
  staticData: { crumb: "Action" },
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.prefetchQuery(actionQuery(params.id))
  },
  component: ActionRedirect,
})

function ActionRedirect() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const action = useQuery(actionQuery(id))
  const callId = action.data?.call_id
  useEffect(() => {
    if (callId)
      void navigate({
        to: "/activity/$id",
        params: { id: callId },
        replace: true,
      })
  }, [callId, navigate])
  if (action.isError || (action.data && !callId))
    return (
      <Page>
        <PageHeader>
          <PageTitle>Action</PageTitle>
        </PageHeader>
        <QueryError
          title={
            action.error instanceof ApiError && action.error.status === 404
              ? "This action is not in the history"
              : "This action has no call record"
          }
          error={action.error ?? new Error("Call not found")}
          onRetry={action.isError ? () => void action.refetch() : undefined}
        />
      </Page>
    )
  return (
    <Page>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-56 rounded-3xl" />
    </Page>
  )
}
