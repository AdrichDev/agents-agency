"use client";

import dynamic from "next/dynamic";

// Monaco editor — loaded only client-side (ssr: false)
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center h-full text-slate-500 text-sm">
      Cargando editor...
    </div>
  )}
);

function getLanguage(path: string): string {
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".dart")) return "dart";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}

interface Props {
  path: string | null;
  content: string;
  onChange: (content: string) => void;
}

export function CodeEditor({ path, content, onChange }: Props) {
  if (!path) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        Selecciona un archivo del árbol
      </div>
    );
  }

  return (
    <MonacoEditor
      height="100%"
      language={getLanguage(path)}
      value={content}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        fontFamily: '"Fira Code", "Cascadia Code", monospace',
        fontLigatures: true,
        wordWrap: "on",
        scrollBeyondLastLine: false,
        renderLineHighlight: "gutter",
        smoothScrolling: true,
      }}
      onChange={(val) => onChange(val ?? "")}
    />
  );
}
