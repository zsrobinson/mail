import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts"
import { useIsMobile } from "@zsrobinson/shell/hooks/use-mobile"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@zsrobinson/shell/ui/chart"
import { chartNumber } from "@zsrobinson/shell/blocks/chart-card"
import { epoch, formatMs } from "@/lib/format"
import { countTicks, evenTicks } from "@/lib/ticks"
import type { LatencyPoint } from "@/lib/types"

type Row = { start: string } & Record<string, number | string>

const tickFormat = (bucketSeconds: number) => (value: number) =>
  new Date(value * 1000).toLocaleString(
    undefined,
    bucketSeconds >= 86_400
      ? { month: "short", day: "numeric" }
      : bucketSeconds >= 21_600
        ? { weekday: "short", hour: "numeric" }
        : { hour: "numeric" }
  )

/** Stacked bars per time bucket, using the shared Rhea chart container. */
export function StackedBars({
  rows,
  config,
  bucketSeconds,
  label,
  height = "h-56",
  maxTicks = 7,
}: {
  rows: Row[]
  config: ChartConfig
  bucketSeconds: number
  label: string
  height?: string
  /** Most x labels at desktop width; phones get half. */
  maxTicks?: number
}) {
  const mobile = useIsMobile()
  const keys = Object.keys(config)
  const data = rows.map((row) => ({ ...row, time: epoch(row.start) }))
  const format = tickFormat(bucketSeconds)
  const ticks = evenTicks(
    data.map((d) => d.time),
    mobile ? Math.ceil(maxTicks / 2) : maxTicks
  )
  const max = Math.max(
    0,
    ...rows.map((row) => keys.reduce((sum, k) => sum + Number(row[k] ?? 0), 0))
  )
  const yTicks = countTicks(max)
  return (
    <ChartContainer
      config={config}
      role="img"
      aria-label={label}
      className={`w-full tabular-nums ${height}`}
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ left: 0, right: 20, top: 8, bottom: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="time"
          tickLine={false}
          axisLine={false}
          ticks={ticks}
          interval={0}
          tickMargin={8}
          tickFormatter={format}
        />
        <YAxis
          width={32}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          ticks={yTicks}
          domain={yTicks ? [0, yTicks[yTicks.length - 1]] : [0, "auto"]}
          tickFormatter={chartNumber}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const time = Number(payload?.[0]?.payload?.time)
                return Number.isFinite(time)
                  ? new Date(time * 1000).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: bucketSeconds < 86_400 ? "numeric" : undefined,
                    })
                  : ""
              }}
            />
          }
        />
        {keys.length > 1 ? (
          <ChartLegend
            content={<ChartLegendContent />}
            itemSorter={(item) => keys.indexOf(String(item.dataKey))}
          />
        ) : null}
        {keys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="a"
            fill={`var(--color-${key})`}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
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
  const data = points.map((p) => ({ time: epoch(p.time), ms: p.ms }))
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
                  ? new Date(time * 1000).toLocaleTimeString(undefined, {
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
