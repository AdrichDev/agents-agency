"use client";

interface Props {
  html: string;
}

export function LivePreview({ html }: Props) {
  if (!html) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        <div className="text-center">
          <p className="text-3xl mb-3">👁️</p>
          <p>El preview aparecerá aquí una vez generada la landing</p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      title="Landing preview"
      // Security: allow-scripts only — no allow-same-origin to isolate AI-generated code
      sandbox="allow-scripts"
      srcDoc={html}
      className="w-full h-full border-0 bg-white"
    />
  );
}
