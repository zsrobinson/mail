/** Axis tick helpers shared by the time-series charts. */

/**
 * Evenly spaced tick values, counted back from the newest bucket so the right
 * edge is always labelled and every gap is the same number of buckets.
 */
export function evenTicks<T>(values: T[], maxTicks: number) {
  const step = Math.max(1, Math.ceil(values.length / Math.max(1, maxTicks)))
  const ticks: T[] = []
  for (let i = values.length - 1; i >= 0; i -= step) ticks.unshift(values[i])
  return ticks
}

/** Whole-number y ticks for small counts; larger ranges use Recharts' own. */
export function countTicks(max: number) {
  if (max > 5) return undefined
  const top = Math.max(1, Math.ceil(max))
  return Array.from({ length: top + 1 }, (_, i) => i)
}
