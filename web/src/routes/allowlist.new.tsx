import { useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { FormStack, Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card, CardContent, CardFooter } from "@zsrobinson/shell/ui/card"
import { Spinner } from "@zsrobinson/shell/ui/spinner"
import {
  SenderFields,
  senderErrors,
  senderInput,
  type SenderDraft,
} from "@/components/sender-fields"
import { useAddSender } from "@/lib/mutations"

export const Route = createFileRoute("/allowlist/new")({
  staticData: { crumb: "Add sender" },
  component: AddSenderPage,
})

function AddSenderPage() {
  const navigate = useNavigate()
  const add = useAddSender()
  const [draft, setDraft] = useState<SenderDraft>({
    address: "",
    note: "",
    until: "",
  })
  const [submitted, setSubmitted] = useState(false)
  const valid = Object.values(senderErrors(draft)).every((e) => !e)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Add sender</PageTitle>
      </PageHeader>
      <FormStack>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
            if (!valid || add.isPending) return
            add.mutate(senderInput(draft), {
              onSuccess: ({ entry }) =>
                void navigate({
                  to: "/allowlist/$id",
                  params: { id: entry.id },
                }),
            })
          }}
        >
          <Card>
            <CardContent>
              <SenderFields
                draft={draft}
                onChange={setDraft}
                showErrors={submitted}
                autoFocus
              />
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? <Spinner data-icon="inline-start" /> : null}
                Add sender
              </Button>
              <Button
                variant="outline"
                render={<Link to="/allowlist" />}
                nativeButton={false}
              >
                Cancel
              </Button>
            </CardFooter>
          </Card>
        </form>
      </FormStack>
    </Page>
  )
}
