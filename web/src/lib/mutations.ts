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
    mutationFn: (input: Partial<AllowlistInput> & { success?: string }) => {
      const { success: _success, ...body } = input
      void _success
      return sendJson<{ entry: AllowlistEntry }>(
        "PATCH",
        `/api/allowlist/${encodeURIComponent(id)}`,
        body
      )
    },
    onSuccess: (_, input) => {
      toast.success(input.success ?? "Changes saved")
      void client.invalidateQueries({ queryKey: ["overview"] })
      return client.invalidateQueries({ queryKey: ["allowlist"] })
    },
    onError: fail("Changes not saved"),
  })
}

/** Undo a removal: the same entry returns with its matches and history. */
export function useRestoreSender() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sendJson<{ entry: AllowlistEntry }>(
        "POST",
        `/api/allowlist/${encodeURIComponent(id)}/restore`
      ),
    onSuccess: ({ entry }) => {
      toast.success(`Restored ${entry.address}`)
      void client.invalidateQueries({ queryKey: ["overview"] })
      return client.invalidateQueries({ queryKey: ["allowlist"] })
    },
    onError: fail("Sender not restored"),
  })
}

export function useRemoveSender(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      sendJson<object>("DELETE", `/api/allowlist/${encodeURIComponent(id)}`),
    onSuccess: () => {
      client.removeQueries({ queryKey: ["allowlist", id] })
      void client.invalidateQueries({ queryKey: ["overview"] })
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
      void client.invalidateQueries({ queryKey: ["call"] })
      return client.invalidateQueries({ queryKey: ["action", id] })
    },
    onError: fail("Unarchive failed"),
  })
}
