/**
 * Minimal, XSS-safe markdown → HTML renderer for AI-generated study content.
 * Escapes &, <, > FIRST so any raw HTML in the markdown is neutralized; links
 * are restricted to http(s) and rendered with rel="noopener noreferrer".
 * The output is intended for `dangerouslySetInnerHTML`.
 */
export function renderMarkdown(md: string): string {
  if (!md) return "";
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3 class='text-base font-semibold text-white mt-4 mb-1'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='text-lg font-bold text-white mt-5 mb-2'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class='text-xl font-bold text-white mt-6 mb-2'>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong class='text-white'>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em class='text-slate-300'>$1</em>")
    // Markdown links → anchor with noopener (must run before list/paragraph rules)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<a href='$2' target='_blank' rel='noopener noreferrer' class='text-violet-400 hover:text-violet-300 underline'>$1</a>")
    .replace(/^- (.+)$/gm, "<li class='ml-4 list-disc text-slate-300'>$1</li>")
    .replace(/(<li.*<\/li>\n?)+/g, (m) => `<ul class='space-y-0.5 my-2'>${m}</ul>`)
    .replace(/^(\d+)\. (.+)$/gm, "<li class='ml-4 list-decimal text-slate-300'>$2</li>")
    .replace(/\n\n/g, "</p><p class='text-slate-400 text-sm mt-2'>")
    .replace(/^(?!<[hul])(.+)$/gm, "<p class='text-slate-400 text-sm'>$1</p>");
}
