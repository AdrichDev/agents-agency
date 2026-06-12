"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { useIsolation } from "./useIsolation";

interface MonthlyPoint {
  month: string;
  agents: number;
  leads: number;
  conversations: number;
  budgets: number;
}

interface Props {
  data: MonthlyPoint[];
  onBarClick?: (entry: { activeLabel?: string }) => void;
}

const SERIES = [
  { key: "agents", label: "Agentes", color: "#9d00ff" },
  { key: "leads", label: "Leads", color: "#00f0ff" },
  { key: "conversations", label: "Conversaciones", color: "#d946ef" },
  { key: "budgets", label: "Presupuestos", color: "#ff9900" },
] as const;

export default function MonthlyBarChart({ data, onBarClick }: Props) {
  const { toggle, isHidden, legendStyle } = useIsolation();

  return (
    <div className="card p-5">
      <span className="kicker block mb-4">Series mensuales — últimos 12 meses</span>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          onClick={onBarClick as any}
          className="cursor-pointer"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: "#8b8baf", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#8b8baf", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{ background: "#0d0d16", border: "1px solid rgba(157,0,255,0.25)", borderRadius: 10 }}
            labelStyle={{ color: "#cbd5e1", fontSize: 12 }}
            itemStyle={{ fontSize: 12 }}
            cursor={{ fill: "rgba(157,0,255,0.08)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8, cursor: "pointer" }}
            onClick={(item) => {
              if (item?.dataKey) toggle(String(item.dataKey));
            }}
            formatter={(value, entry) => (
              <span style={legendStyle(String(entry?.dataKey ?? value))}>{value}</span>
            )}
          />
          {SERIES.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              hide={isHidden(s.key)}
              radius={[3, 3, 0, 0]}
              maxBarSize={18}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
