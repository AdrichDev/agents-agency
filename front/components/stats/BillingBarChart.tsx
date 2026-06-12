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

interface BillingMonthPoint {
  month: string;
  total: number;
  draft: number;
  sent: number;
  accepted: number;
  rejected: number;
}

interface Props {
  data: BillingMonthPoint[];
  onBarClick?: (entry: { activeLabel?: string }) => void;
}

const STATUSES = ["draft", "sent", "accepted", "rejected"] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: "#8b8baf",
  sent: "#0066ff",
  accepted: "#00c47a",
  rejected: "#ff3b5c",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
};

function euroFormatter(value: number) {
  return `${value.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;
}

export default function BillingBarChart({ data, onBarClick }: Props) {
  const { toggle, isHidden, legendStyle } = useIsolation();

  const visibleStatuses = STATUSES.filter((s) => !isHidden(s));
  const topVisible = visibleStatuses[visibleStatuses.length - 1];

  return (
    <div className="card p-5">
      <span className="kicker block mb-4">Facturación mensual por estado</span>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} onClick={onBarClick as any}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: "#8b8baf", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v) => `${v}€`}
            tick={{ fill: "#8b8baf", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value, name) => [euroFormatter(Number(value)), STATUS_LABELS[String(name)] ?? String(name)]}
            contentStyle={{ background: "#0d0d16", border: "1px solid rgba(0,102,255,0.25)", borderRadius: 10 }}
            labelStyle={{ color: "#cbd5e1", fontSize: 12 }}
            itemStyle={{ fontSize: 12 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8, cursor: "pointer" }}
            onClick={(item) => {
              if (item?.dataKey) toggle(String(item.dataKey));
            }}
            formatter={(value, entry) => (
              <span style={legendStyle(String(entry?.dataKey ?? value))}>
                {STATUS_LABELS[String(value)] ?? String(value)}
              </span>
            )}
          />
          {STATUSES.map((s) => (
            <Bar
              key={s}
              dataKey={s}
              name={s}
              stackId="a"
              fill={STATUS_COLORS[s]}
              hide={isHidden(s)}
              radius={s === topVisible ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
