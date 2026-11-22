import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { DetailList, DetailRow } from "@zsrobinson/shell/blocks/detail-list"
import { formatRelative } from "@zsrobinson/shell/lib/format"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@zsrobinson/shell/ui/card"
import { Spinner } from "@zsrobinson/shell/ui/spinner"
import { formatInteger } from "@/lib/format"
import { useConfirmUnarchive, usePreviewUnarchive } from "@/lib/mutations"
import type { Action, UnarchivePreview } from "@/lib/types"

/**
 * Archive-to-INBOX undo. A preview checks the mailbox and changes nothing;
 * its single-use token is the only way to confirm.
 */
export function UnarchiveCard({ action }: { action: Action }) {
  const navigate = useNavigate()
  const unarchive = action.unarchive!
  const preview = usePreviewUnarchive(action.id)
  const confirm = useConfirmUnarchive(action.id)
  const [pending, setPending] = useState<UnarchivePreview | null>(null)
  const plural = (n: number) => (n === 1 ? "message" : "messages")
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Undo this archive</CardTitle>
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
            Moves the {formatInteger(action.counts.completed)} archived{" "}
            {plural(action.counts.completed)} from Archive back to INBOX. The
            preview checks the mailbox first and changes nothing.
          </p>
        )}
      </CardContent>
      {unarchive.eligible && !unarchive.restored_by ? (
        <CardFooter className="mt-auto flex flex-wrap gap-2">
          {pending ? (
            <>
              <Button
                disabled={confirm.isPending}
                onClick={() =>
                  confirm.mutate(pending.preview_token, {
                    onSuccess: (result) => {
                      setPending(null)
                      void navigate({
                        to: "/actions/$id",
                        params: { id: result.action_id },
                      })
                    },
                  })
                }
              >
                {confirm.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Move {formatInteger(pending.messages)}{" "}
                {plural(pending.messages)} to INBOX
              </Button>
              <Button
                variant="outline"
                disabled={confirm.isPending}
                onClick={() => setPending(null)}
              >
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
    </Card>
  )
}
