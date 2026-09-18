"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type NetSalesPoint = {
  label: string;
  current: number;
  prior: number | null;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const moneyExact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Net sales over time: current period as bars, the prior period as a line on the
// same axis (spec §11). One y-scale — two measures of the same kind, so there is
// never a second axis.
export function NetSalesChart({ data }: { data: NetSalesPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            minTickGap={16}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(value: number) => money.format(value)}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
            formatter={(value, name) => [moneyExact.format(Number(value)), String(name)]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
            iconType="circle"
          />
          <Bar
            dataKey="current"
            name="This period"
            fill="var(--chart-1)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
          />
          <Line
            type="monotone"
            dataKey="prior"
            name="Prior period"
            stroke="var(--chart-2)"
            strokeWidth={2}
            strokeLinecap="round"
            dot={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
