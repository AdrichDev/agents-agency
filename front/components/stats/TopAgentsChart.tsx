"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
} from "recharts";
import { useIsolation } from "./useIsolation";

interface TopAgent {
  agentId: string;
  agentName: string;
  conversations: number;
}

interface Props {
  data: TopAgent[];
}

const NEON = ["#9d00ff", "#d946ef", "#0066ff", "#00f0ff", "#ff9900"];

export default function TopAgentsChart({ data }: Props) {
  const { isolated, toggle, legendStyle } = useIsolation();

  const chartData = data.map((a) => ({ name: a.agentName, conversations: a.conversations }));
  const colorOf = (name: string) =>
    NEON[Math.max(0, chartData.findIndex((a) => a.name === name)) % NEON.length];
  const visibleData = isolated ? chartData.filter((a) => a.name === isolated) : chartData;

  return (
    <div className="card p-5">
      <span className="kicker block mb-4">Top 5 agentes por conversaciones</span>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          layout="vertical"
          data={visibleData}
          margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fill: "#8b8baf", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fill: "#cbd5e1", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ background: "#0d0d16", border: "1px solid rgba(157,0,255,0.25)", borderRadius: 10 }}
            itemStyle={{ fontSize: 12 }}
            cursor={{ fill: "rgba(157,0,255,0.08)" }}
          />
          <Bar dataKey="conversations" name="Conversaciones" radius={[0, 4, 4, 0]} maxBarSize={26}>
            {visibleData.map((a) => (
              <Cell
                key={a.name}
                fill={colorOf(a.name)}
                cursor="pointer"
                onClick={() => toggle(a.name)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* Custom legend: recharts v3 Legend does not accept a custom payload,
          and the single Bar would only yield one legend item. */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-xs">
        {chartData.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={() => toggle(a.name)}
            className="flex items-center gap-1.5 bg-transparent border-0 p-0"
            style={legendStyle(a.name)}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: colorOf(a.name) }}
            />
            <span className="text-slate-300">{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
