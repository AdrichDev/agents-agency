"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";

/**
 * Shell condicional: la landing pública (/) se renderiza limpia,
 * el resto de rutas llevan el chrome del dashboard (sidebar + topbar).
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/") {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <Suspense fallback={<div className="h-16 border-b border-edge bg-ink/80" />}>
          <Topbar />
        </Suspense>
        <div className="flex-1 overflow-y-auto flex flex-col">
          <Suspense fallback={<div className="p-8 text-slate-500">Cargando...</div>}>
            {/* flex flex-col flex-1 (sin min-height:0, paridad con .opera-content de
                OperaOS): permite que páginas como /agenda (h-full) reciban una altura
                real del flex layout, sin recortar páginas normales más altas que el
                viewport (siguen creciendo con su contenido y scrollean vía el div
                padre .overflow-y-auto). */}
            <main className="flex w-full max-w-[1400px] flex-1 flex-col mx-auto px-4 py-8">{children}</main>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
