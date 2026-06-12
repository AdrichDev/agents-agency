"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import { useIsolation } from "./useIsolation";

interface DataItem {
  name: string;
  value: number;
}

interface Props {
  title: string;
  data: DataItem[];
  colors: string[];
}

export default function DonutChart({ title, data, colors }: Props) {
  const { isolated, toggle, legendStyle } = useIsolation();

  const total = data.reduce((sum, d) => sum + d.value, 0);

  // Zero-out non-isolated slices instead of filtering: the legend keeps
  // every category visible and clickable while only the isolated slice renders.
  const pieData = isolated
    ? data.map((d) => (d.name === isolated ? d : { ...d, value: 0 }))
    : data;

  return (
    <div className="card p-5">
      <span className="kicker block mb-4">{title}</span>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius="52%"
            outerRadius="75%"
            paddingAngle={3}
            dataKey="value"
            stroke="none"
          >
            {pieData.map((d, i) => (
              <Cell
                key={d.name}
                fill={colors[i % colors.length]}
                cursor="pointer"
                onClick={() => toggle(d.name)}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => {
              const pct = total > 0 ? ((Number(value) / total) * 100).toFixed(1) : "0";
              return [`${value} (${pct}%)`, String(name)];
            }}
            contentStyle={{ background: "#0d0d16", border: "1px solid rgba(157,0,255,0.25)", borderRadius: 10 }}
            itemStyle={{ fontSize: 12 }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, paddingTop: 8, cursor: "pointer" }}
            onClick={(item) => {
              if (item?.value) toggle(String(item.value));
            }}
            formatter={(value) => (
              <span style={legendStyle(String(value))}>{String(value)}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
