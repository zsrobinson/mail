import { formatInteger } from "@/lib/format"

/** A row of labelled totals above a chart. */
export function Totals({ items }: { items: [string, number][] }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 text-lg font-medium tabular-nums">
            {formatInteger(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
