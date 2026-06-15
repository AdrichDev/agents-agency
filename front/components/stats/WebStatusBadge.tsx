import type { WebsiteStatus } from "./studyTypes";

export default function WebStatusBadge({ status }: { status?: WebsiteStatus }) {
  if (!status) return <span className="text-slate-600 text-xs">—</span>;
  const map: Record<WebsiteStatus, { label: string; cls: string }> = {
    no_web: { label: "Sin web", cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
    web_no_chatbot: { label: "Web s/chatbot", cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    web_chatbot: { label: "Web c/chatbot", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}
