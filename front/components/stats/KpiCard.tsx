"use client";

interface KpiCardProps {
  label: string;
  value: number | string;
  sub?: string;
  accent?: string; // CSS color or var
}

export default function KpiCard({ label, value, sub, accent = "var(--neon-purple)" }: KpiCardProps) {
  return (
    <div className="card p-5 flex flex-col gap-1">
      <span className="kicker">{label}</span>
      <span
        className="text-3xl font-bold leading-none"
        style={{ color: accent, textShadow: `0 0 12px ${accent}55` }}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-slate-500 mt-1">{sub}</span>}
    </div>
  );
}
