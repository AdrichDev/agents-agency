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
        <div className="flex-1 overflow-y-auto">
          <Suspense fallback={<div className="p-8 text-slate-500">Cargando...</div>}>
            <main className="px-4 py-8 w-full max-w-[1400px] mx-auto">{children}</main>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
