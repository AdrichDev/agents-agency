"use client";

interface Props {
  files: Record<string, string>;
  mobileFiles?: Record<string, string>;
  activePath: string | null;
  onSelect: (path: string) => void;
  showMobile?: boolean;
}

function getFileIcon(path: string): string {
  if (path.endsWith(".html")) return "📄";
  if (path.endsWith(".css")) return "🎨";
  if (path.endsWith(".js") || path.endsWith(".ts") || path.endsWith(".tsx")) return "⚡";
  if (path.endsWith(".json")) return "{}";
  if (path.endsWith(".dart")) return "🎯";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "⚙️";
  if (path.endsWith(".md")) return "📝";
  return "📁";
}

export function FileTree({ files, mobileFiles, activePath, onSelect, showMobile }: Props) {
  const landingEntries = Object.keys(files).sort();
  const mobileEntries = mobileFiles ? Object.keys(mobileFiles).sort() : [];

  function FileItem({ path, active, onClick }: { path: string; active: boolean; onClick: () => void }) {
    const icon = getFileIcon(path);
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const indent = (parts.length - 1) * 12;

    return (
      <button
        className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition ${
          active
            ? "bg-indigo-600/20 border border-indigo-500/30 text-indigo-300"
            : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
        }`}
        style={{ paddingLeft: `${12 + indent}px` }}
        onClick={onClick}
        title={path}
      >
        <span>{icon}</span>
        <span className="truncate">{name}</span>
      </button>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-2">
      {landingEntries.length === 0 && mobileEntries.length === 0 && (
        <p className="text-xs text-slate-500 px-3 py-2">Sin archivos</p>
      )}

      {landingEntries.length > 0 && (
        <>
          <p className="kicker px-3 pb-1.5 pt-1">Landing</p>
          {landingEntries.map((path) => (
            <FileItem
              key={path}
              path={path}
              active={activePath === path}
              onClick={() => onSelect(path)}
            />
          ))}
        </>
      )}

      {showMobile && mobileEntries.length > 0 && (
        <>
          <p className="kicker px-3 pb-1.5 pt-3">Móvil</p>
          {mobileEntries.map((path) => (
            <FileItem
              key={`mobile:${path}`}
              path={path}
              active={activePath === `mobile:${path}`}
              onClick={() => onSelect(`mobile:${path}`)}
            />
          ))}
        </>
      )}
    </div>
  );
}
