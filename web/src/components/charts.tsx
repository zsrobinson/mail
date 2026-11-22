import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  LabelList,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@zsrobinson/shell/ui/chart"
import {
  chartNumber,
  type ChartPoint,
} from "@zsrobinson/shell/blocks/chart-card"
import { formatMs } from "@/lib/format"
import type { LatencyPoint } from "@/lib/types"

/** Dense series from the API (ISO `start`) as shell chart points (epoch ms). */
export function toPoints<K extends string>(
  rows: ({ start: string } & Record<K, number>)[],
  keys: readonly K[]
): ChartPoint[] {
  return rows.map((row) => ({
    time: Date.parse(row.start),
    ...Object.fromEntries(keys.map((k) => [k, row[k]])),
  }))
}

/** One horizontal bar per category with its value at the end. */
export function CategoryBars({
  rows,
  config,
  label,
}: {
  rows: { name: string; value: number; detail?: string }[]
  config: ChartConfig
  label: string
}) {
  return (
    <ChartContainer
      config={config}
      role="img"
      aria-label={label}
      className="w-full tabular-nums"
      style={{ height: rows.length * 36 + 8 }}
    >
      <BarChart
        accessibilityLayer
        data={rows}
        layout="vertical"
        margin={{ left: 0, right: 40, top: 0, bottom: 0 }}
        barCategoryGap={8}
      >
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={84}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={(_, __, item) => (
                <span className="tabular-nums">{item.payload.detail}</span>
              )}
            />
          }
        />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          radius={3}
          minPointSize={2}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            className="fill-foreground"
            fontSize={12}
            formatter={(value: unknown) => chartNumber(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

const sparkConfig = { ms: { label: "Latency", color: "var(--chart-1)" } }

/**
 * Recent latency samples. A failed sample has no latency, so it leaves a gap
 * in the line and is marked by an orange dot at the neighbouring level.
 */
export function LatencySparkline({
  points,
  label,
}: {
  points: LatencyPoint[]
  label: string
}) {
  const data = points.map((p) => ({ time: Date.parse(p.time), ms: p.ms }))
  const measured = data.flatMap((d) => (d.ms === null ? [] : [d.ms]))
  const failures = data.flatMap((d, i) => {
    if (d.ms !== null) return []
    const before = data.slice(0, i).findLast((p) => p.ms !== null)?.ms
    const after = data.slice(i + 1).find((p) => p.ms !== null)?.ms
    const level =
      before != null && after != null
        ? (before + after) / 2
        : (before ?? after ?? 0)
    return [{ time: d.time, level }]
  })
  if (measured.length === 0 && failures.length === 0)
    return (
      <div role="status" className="h-12 text-sm text-muted-foreground">
        No samples yet
      </div>
    )
  const description =
    failures.length > 0
      ? `${label}, ${failures.length} failed of ${data.length} samples`
      : label
  return (
    <ChartContainer
      config={sparkConfig}
      role="img"
      aria-label={description}
      className="h-12 w-full"
    >
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
        <XAxis
          dataKey="time"
          type="number"
          domain={["dataMin", "dataMax"]}
          hide
        />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, payload) => {
                const time = Number(payload?.[0]?.payload?.time)
                return Number.isFinite(time)
                  ? new Date(time).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : ""
              }}
              formatter={(value) => (
                <span className="tabular-nums">
                  {value == null ? "Failed" : formatMs(Number(value))}
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="ms"
          type="monotone"
          stroke="var(--color-ms)"
          fill="var(--color-ms)"
          fillOpacity={0.12}
          strokeWidth={2}
          connectNulls={false}
          isAnimationActive={false}
        />
        {failures.map((f) => (
          <ReferenceDot
            key={f.time}
            x={f.time}
            y={f.level}
            r={3.5}
            fill="var(--chart-3)"
            stroke="var(--card)"
            strokeWidth={1.5}
            ifOverflow="extendDomain"
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}
