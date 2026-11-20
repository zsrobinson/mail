import { useId } from "react"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import { Textarea } from "@zsrobinson/shell/ui/textarea"
import {
  addressError,
  expiryError,
  expiryFromDate,
  NOTE_MAX,
  noteError,
  normalizeAddress,
} from "@/lib/validation"
import type { AllowlistInput } from "@/lib/types"

export type SenderDraft = { address: string; note: string; until: string }

/** Field errors, shown once a field is touched or the form is submitted. */
export function senderErrors(draft: SenderDraft) {
  return {
    address: addressError(draft.address),
    note: noteError(draft.note),
    until: draft.until ? expiryError(expiryFromDate(draft.until)) : null,
  }
}

export function senderInput(draft: SenderDraft): AllowlistInput {
  return {
    address: normalizeAddress(draft.address),
    note: draft.note.trim(),
    expires_at: expiryFromDate(draft.until) ?? null,
  }
}

const tomorrow = () =>
  new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

export function SenderFields({
  draft,
  onChange,
  showErrors,
  autoFocus,
}: {
  draft: SenderDraft
  onChange: (draft: SenderDraft) => void
  showErrors: boolean
  autoFocus?: boolean
}) {
  const id = useId()
  const errors = senderErrors(draft)
  return (
    <FieldGroup>
      <Field data-invalid={showErrors && Boolean(errors.address)}>
        <FieldLabel htmlFor={`${id}-address`}>Address</FieldLabel>
        <Input
          id={`${id}-address`}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder="name@example.org"
          value={draft.address}
          aria-invalid={showErrors && Boolean(errors.address)}
          onChange={(e) => onChange({ ...draft, address: e.target.value })}
        />
        {showErrors && errors.address ? (
          <FieldError>{errors.address}</FieldError>
        ) : (
          <FieldDescription>
            One exact address. Authenticated mail from it can be read.
          </FieldDescription>
        )}
      </Field>
      <Field data-invalid={showErrors && Boolean(errors.note)}>
        <FieldLabel htmlFor={`${id}-note`}>Note</FieldLabel>
        <Textarea
          id={`${id}-note`}
          rows={3}
          maxLength={NOTE_MAX}
          placeholder="Why this sender is allowed"
          value={draft.note}
          onChange={(e) => onChange({ ...draft, note: e.target.value })}
        />
        {showErrors && errors.note ? (
          <FieldError>{errors.note}</FieldError>
        ) : null}
      </Field>
      <Field data-invalid={showErrors && Boolean(errors.until)}>
        <FieldLabel htmlFor={`${id}-until`}>Allow until</FieldLabel>
        <Input
          id={`${id}-until`}
          type="date"
          min={tomorrow()}
          className="w-full sm:w-48"
          value={draft.until}
          onChange={(e) => onChange({ ...draft, until: e.target.value })}
        />
        {showErrors && errors.until ? (
          <FieldError>{errors.until}</FieldError>
        ) : (
          <FieldDescription>
            {draft.until
              ? "Access ends at the end of this day, UTC."
              : "Leave empty to allow with no end date."}
          </FieldDescription>
        )}
      </Field>
    </FieldGroup>
  )
}
