import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@zsrobinson/shell"
import { errorMessage, sendJson } from "./api"
import type {
  AllowlistEntry,
  AllowlistInput,
  UnarchivePreview,
  UnarchiveResult,
} from "./types"

const fail = (title: string) => (error: unknown) =>
  toast.error(title, { description: errorMessage(error) })

export function useAddSender() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: AllowlistInput) =>
      sendJson<{ entry: AllowlistEntry }>("POST", "/api/allowlist", input),
    onSuccess: ({ entry }) => {
      toast.success(`Added ${entry.address}`)
      return client.invalidateQueries({ queryKey: ["allowlist"] })
    },
    onError: fail("Sender not added"),
  })
}

export function useUpdateSender(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<AllowlistInput>) =>
      sendJson<{ entry: AllowlistEntry }>(
        "PATCH",
        `/api/allowlist/${encodeURIComponent(id)}`,
        input
      ),
    onSuccess: () => {
      toast.success("Changes saved")
      return client.invalidateQueries({ queryKey: ["allowlist"] })
    },
    onError: fail("Changes not saved"),
  })
}

export function useRemoveSender(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      sendJson<object>("DELETE", `/api/allowlist/${encodeURIComponent(id)}`),
    onSuccess: () => {
      client.removeQueries({ queryKey: ["allowlist", id] })
      return client.invalidateQueries({ queryKey: ["allowlist"] })
    },
    onError: fail("Sender not removed"),
  })
}

const unarchiveUrl = (id: string) =>
  `/api/actions/${encodeURIComponent(id)}/unarchive`

export function usePreviewUnarchive(id: string) {
  return useMutation({
    mutationFn: () =>
      sendJson<UnarchivePreview>("POST", unarchiveUrl(id), { dry_run: true }),
    onError: fail("Preview failed"),
  })
}

export function useConfirmUnarchive(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (previewToken: string) =>
      sendJson<UnarchiveResult>("POST", unarchiveUrl(id), {
        dry_run: false,
        preview_token: previewToken,
      }),
    onSuccess: (result) => {
      toast.success(`Unarchived ${result.counts.completed} messages`)
      void client.invalidateQueries({ queryKey: ["activity"] })
      void client.invalidateQueries({ queryKey: ["overview"] })
      return client.invalidateQueries({ queryKey: ["action", id] })
    },
    onError: fail("Unarchive failed"),
  })
}
