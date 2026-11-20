import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@zsrobinson/shell/ui/chart"
import { chartNumber } from "@zsrobinson/shell/blocks/chart-card"
import { epoch } from "@/lib/format"

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
}: {
  rows: Row[]
  config: ChartConfig
  bucketSeconds: number
  label: string
  height?: string
}) {
  const keys = Object.keys(config)
  const data = rows.map((row) => ({ ...row, time: epoch(row.start) }))
  const format = tickFormat(bucketSeconds)
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
        margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="time"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickMargin={8}
          tickFormatter={format}
        />
        <YAxis
          width={32}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
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
