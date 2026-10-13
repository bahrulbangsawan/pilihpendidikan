// The Stats charts (10 §8), drawn with the Zedative chart wrapper of
// @rulisme/ui: series colours are the `--chart-N` tokens only, the grid is a
// hairline, nothing animates in (DESIGN.md § Motion). Each chart is a
// picture of its view model; ChartFrame pairs it with the same numbers as a
// table. Recharts' own keyboard layer is off: the chart sits inside
// role="img" and the data table is the keyboard path (T10-10).

import type { ChartConfig } from "@rulisme/ui/ui/chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@rulisme/ui/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "@/i18n";
import type { BarRow, SeriesPoint, TimingPoint } from "@/lib/stats-model";

/** Recharts measures its box; tests and the first paint use this size. */
const INITIAL_DIMENSION = { width: 640, height: 240 } as const;
const CATEGORY_AXIS_WIDTH = 132;
const FUNNEL_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

function HorizontalBars({
  rows,
  config,
  colors,
}: {
  rows: readonly BarRow[];
  config: ChartConfig;
  colors?: readonly string[];
}) {
  return (
    <ChartContainer
      className="aspect-auto h-60 w-full"
      config={config}
      initialDimension={INITIAL_DIMENSION}
    >
      <BarChart
        accessibilityLayer={false}
        data={[...rows]}
        layout="vertical"
        margin={{ left: 0, right: 40 }}
      >
        <CartesianGrid horizontal={false} />
        <XAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          type="number"
        />
        <YAxis
          axisLine={false}
          dataKey="label"
          tickLine={false}
          type="category"
          width={CATEGORY_AXIS_WIDTH}
        />
        <ChartTooltip
          content={<ChartTooltipContent hideLabel={false} indicator="line" />}
          cursor={false}
        />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          isAnimationActive={false}
          maxBarSize={28}
        >
          {colors
            ? rows.map((row, index) => (
                <Cell fill={colors[index % colors.length]} key={row.key} />
              ))
            : null}
          <LabelList
            className="fill-foreground"
            dataKey="value"
            position="right"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Tracked → applied → interviewing → offer → accepted (10 §2.1). */
export function FunnelChart({ rows }: { rows: readonly BarRow[] }) {
  const { t } = useTranslation();
  return (
    <HorizontalBars
      colors={FUNNEL_COLORS}
      config={{
        value: { label: t("stats.funnel.count"), color: "var(--chart-1)" },
      }}
      rows={rows}
    />
  );
}

/** Rejections by the stage they happened at (10 §2.3). */
export function RejectionChart({ rows }: { rows: readonly BarRow[] }) {
  const { t } = useTranslation();
  return (
    <HorizontalBars
      config={{
        value: { label: t("stats.rejection.count"), color: "var(--chart-2)" },
      }}
      rows={rows}
    />
  );
}

/** Applications (or interviews, offers…) per week (10 §2.5). */
export function SeriesChart({
  points,
  metricName,
}: {
  points: readonly SeriesPoint[];
  metricName: string;
}) {
  return (
    <ChartContainer
      className="aspect-auto h-60 w-full"
      config={{ value: { label: metricName, color: "var(--chart-1)" } }}
      initialDimension={INITIAL_DIMENSION}
    >
      <LineChart
        accessibilityLayer={false}
        data={[...points]}
        margin={{ left: 0, right: 12, top: 8 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="label"
          interval="preserveStartEnd"
          minTickGap={24}
          tickLine={false}
          tickMargin={8}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickCount={4}
          tickLine={false}
          width={32}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Line
          dataKey="value"
          dot={{ r: 2.5, fill: "var(--color-value)" }}
          isAnimationActive={false}
          stroke="var(--color-value)"
          strokeWidth={2}
          type="linear"
        />
      </LineChart>
    </ChartContainer>
  );
}

/** Median days per time metric with a whisker out to P75 (10 §2.4). */
export function TimingChart({ points }: { points: readonly TimingPoint[] }) {
  const { t } = useTranslation();
  return (
    <ChartContainer
      className="aspect-auto h-60 w-full"
      config={{
        median: { label: t("stats.timing.median"), color: "var(--chart-1)" },
        p75: { label: t("stats.timing.p75"), color: "var(--chart-3)" },
      }}
      initialDimension={INITIAL_DIMENSION}
    >
      <BarChart
        accessibilityLayer={false}
        data={[...points]}
        layout="vertical"
        margin={{ left: 0, right: 24 }}
      >
        <CartesianGrid horizontal={false} />
        <XAxis
          axisLine={false}
          tickFormatter={(value: number) =>
            t("stats.units.days", { value: String(value) })
          }
          tickLine={false}
          type="number"
        />
        <YAxis
          axisLine={false}
          dataKey="label"
          tickLine={false}
          type="category"
          width={CATEGORY_AXIS_WIDTH}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(_value, _name, item) => {
                const point = item.payload as TimingPoint;
                return t("stats.timing.tooltip", {
                  median: t("stats.units.days", {
                    value: String(point.median),
                  }),
                  p75: t("stats.units.days", { value: String(point.p75) }),
                });
              }}
              indicator="line"
            />
          }
          cursor={false}
        />
        <Bar
          dataKey="median"
          fill="var(--color-median)"
          isAnimationActive={false}
          maxBarSize={20}
        >
          <ErrorBar
            dataKey="whisker"
            direction="x"
            isAnimationActive={false}
            stroke="var(--color-p75)"
            strokeWidth={2}
            width={8}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
