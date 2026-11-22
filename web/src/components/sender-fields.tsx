import { useId } from "react"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@zsrobinson/shell/ui/field"
import { DatePicker } from "@zsrobinson/shell/blocks/date-picker"
import {
  addDays,
  formatCalendarDate,
  viewerTimeZone,
} from "@zsrobinson/shell/lib/calendar-date"
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

/** Quick expiry choices, counted from today in the viewer's zone. */
export const EXPIRY_PRESETS = () => [
  { label: "1 week", value: addDays(7) },
  { label: "30 days", value: addDays(30) },
  { label: "90 days", value: addDays(90) },
  { label: "No end", value: "" },
]

/** "Access ends at 11:59 PM on Nov 29 (America/New_York)." */
export function expiryNote(until: string) {
  if (!until) return "No end date: access lasts until you remove the sender."
  const ended = Date.parse(expiryFromDate(until) ?? "") <= Date.now()
  return `Access ${ended ? "ended" : "ends"} at ${endOfDayLabel(until)} on ${formatCalendarDate(until)} (${viewerTimeZone()}).`
}

/** "11:59 PM EST" for the end of a calendar day in the viewer's zone. */
export function endOfDayLabel(until: string) {
  const end = new Date(expiryFromDate(until) ?? Date.now())
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(end)
}

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
        <DatePicker
          id={`${id}-until`}
          className="w-full sm:w-64"
          value={draft.until}
          placeholder="No end date"
          clearable
          aria-invalid={showErrors && Boolean(errors.until)}
          disabled={{ before: new Date() }}
          presets={EXPIRY_PRESETS()}
          onChange={(until) => onChange({ ...draft, until })}
        />
        {showErrors && errors.until ? (
          <FieldError>{errors.until}</FieldError>
        ) : (
          <FieldDescription>{expiryNote(draft.until)}</FieldDescription>
        )}
      </Field>
    </FieldGroup>
  )
}
