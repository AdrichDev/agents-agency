"use client";

interface Run {
  id: string;
  status: string;
  summary?: string | null;
  toolCalls: unknown[];
  createdAt: string;
}

interface AutomationWithRuns {
  id: string;
  name: string;
  runs: Run[];
}

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  error: "bg-red-500/15 text-red-300 border border-red-500/30",
  skipped: "bg-white/5 text-slate-500 border border-edge",
};

export default function LogsPanel({ automations }: { automations: AutomationWithRuns[] }) {
  const allRuns = automations
    .flatMap((a) => a.runs.map((r) => ({ ...r, automationName: a.name })))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  if (!allRuns.length) {
    return (
      <p className="text-sm text-slate-600 text-center py-16">
        Sin ejecuciones todavía. Las automatizaciones corren cada 5 minutos.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {allRuns.map((r) => (
        <div key={r.id} className="card !rounded-xl p-4 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status] ?? ""}`}>
              {r.status}
            </span>
            <span className="font-medium text-xs text-slate-300">{r.automationName}</span>
            <span className="text-xs text-slate-600 ml-auto">
              {new Date(r.createdAt).toLocaleString("es-ES")}
            </span>
          </div>
          {r.summary && <p className="text-xs text-slate-500">{r.summary}</p>}
          {Array.isArray(r.toolCalls) && r.toolCalls.length > 0 && (
            <p className="text-xs text-slate-600 mt-1">
              {r.toolCalls.length} tool calls: {(r.toolCalls as any[]).map((t) => t.tool).join(", ")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
