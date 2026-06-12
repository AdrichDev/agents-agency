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
import { formatPeriodLabel, formatPeriodTick, xAxisTicks, type PeriodMode } from "./periodFormat";

interface MonthlyPoint {
  month: string;
  agents: number;
  leads: number;
  conversations: number;
  budgets: number;
}

interface Props {
  data: MonthlyPoint[];
  /** Drives X-axis tick formatting (month names, day numbers, year markers). */
  mode: PeriodMode;
  title?: string;
  subtitle?: string;
  onBarClick?: (entry: { activeLabel?: string }) => void;
}

const SERIES = [
  { key: "agents", label: "Agentes", color: "#9d00ff" },
  { key: "leads", label: "Leads", color: "#00f0ff" },
  { key: "conversations", label: "Conversaciones", color: "#d946ef" },
  { key: "budgets", label: "Presupuestos", color: "#ff9900" },
] as const;

export default function MonthlyBarChart({ data, mode, title = "Actividad por periodo", subtitle, onBarClick }: Props) {
  const { toggle, isHidden, legendStyle } = useIsolation();

  const hasData = data.some((d) => d.agents || d.leads || d.conversations || d.budgets);
  const periodKeys = data.map((d) => d.month);
  const ticks = xAxisTicks(periodKeys, mode);
  // Force every tick when the "Nov Dic 2026 Feb…" pattern must stay complete
  const interval = ticks ? 0 : mode.range === "all" && mode.granularity === "month" ? 0 : "preserveStartEnd";

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-baseline justify-between flex-wrap gap-1">
        <span className="kicker block">{title}</span>
        {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
      </div>
      {!hasData ? (
        <div className="h-[280px] flex flex-col items-center justify-center gap-1 text-center">
          <p className="text-slate-400 text-sm">Sin actividad en este periodo</p>
          <p className="text-slate-600 text-xs">Prueba con otro rango o quita algún filtro</p>
        </div>
      ) : (
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
              ticks={ticks}
              interval={interval}
              tickFormatter={(value, index) => formatPeriodTick(String(value), index, mode)}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "#8b8baf", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={32}
              tickFormatter={(v) => Number(v).toLocaleString("es-ES")}
            />
            <Tooltip
              labelFormatter={(label) => formatPeriodLabel(String(label))}
              formatter={(value, name) => [Number(value).toLocaleString("es-ES"), String(name)]}
              contentStyle={{ background: "#0d0d16", border: "1px solid rgba(157,0,255,0.25)", borderRadius: 10 }}
              labelStyle={{ color: "#cbd5e1", fontSize: 12, fontWeight: 600 }}
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
      )}
    </div>
  );
}
