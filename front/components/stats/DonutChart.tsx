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
  /** Label for the center total, e.g. "skills" or "leads". */
  totalLabel?: string;
}

export default function DonutChart({ title, data, colors, totalLabel }: Props) {
  const { isolated, toggle, legendStyle } = useIsolation();

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const countOf = new Map(data.map((d) => [d.name, d.value]));

  // Zero-out non-isolated slices instead of filtering: the legend keeps
  // every category visible and clickable while only the isolated slice renders.
  const pieData = isolated
    ? data.map((d) => (d.name === isolated ? d : { ...d, value: 0 }))
    : data;

  const centerValue = isolated ? countOf.get(isolated) ?? 0 : total;

  return (
    <div className="card p-5">
      <span className="kicker block mb-4">{title}</span>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="46%"
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
          {/* Center total */}
          <text
            x="50%"
            y="44%"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#f1f5f9"
            fontSize={22}
            fontWeight={700}
          >
            {centerValue.toLocaleString("es-ES")}
          </text>
          {totalLabel && (
            <text
              x="50%"
              y="53%"
              textAnchor="middle"
              dominantBaseline="central"
              fill="#8b8baf"
              fontSize={11}
            >
              {isolated ?? totalLabel}
            </text>
          )}
          <Tooltip
            formatter={(value, name) => {
              const pct = total > 0 ? ((Number(value) / total) * 100).toFixed(1) : "0";
              return [`${Number(value).toLocaleString("es-ES")} (${pct}%)`, String(name)];
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
            formatter={(value) => {
              const name = String(value);
              const count = countOf.get(name);
              return (
                <span style={legendStyle(name)}>
                  {name}
                  {typeof count === "number" && (
                    <span style={{ opacity: 0.55 }}> · {count.toLocaleString("es-ES")}</span>
                  )}
                </span>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
