export default function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Borrador", cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
    generating: { label: "Generando…", cls: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
    ready: { label: "Listo", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
    error: { label: "Error", cls: "text-red-400 bg-red-500/10 border-red-500/20" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" };
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>{label}</span>;
}
