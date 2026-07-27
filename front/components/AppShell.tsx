"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { useAuthUser } from "@/hooks/useAuthUser";
import { CLIENT_ROLE, PORTAL_ROOT } from "@/lib/portal";

/** Rutas públicas que se renderizan limpias (sin sidebar/topbar ni auth). */
const CLEAN_PATHS = ["/", "/privacidad", "/aviso-legal", "/cookies"];

/**
 * Shell condicional: la landing pública (/) y las páginas legales se renderizan
 * limpias; el resto de rutas llevan el chrome del dashboard (sidebar + topbar).
 *
 * H5 T4.4 — Aquí vive además la redirección por rol: un usuario de portal en cualquier ruta del
 * estudio va a `/portal`. No es el control de acceso (eso es `clientScopeGate` en el backend, que le
 * deniega cada petición fuera del portal); es lo que evita que el cliente vea una pantalla del estudio
 * llenándose de errores 403. Por eso, además de redirigir, NO se monta el contenido: si se montara,
 * cada página dispararía sus fetch antes de que el router llegase a cambiar de ruta.
 *
 * `PUBLIC_PATHS` no se toca: `/portal` requiere sesión y no es pública.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Una sola instancia del hook para todo el chrome: la sesión se baja a Sidebar por props para no
  // repetir el `GET /api/auth/me` (misma razón por la que TelegramWidgetGlobal no usa el hook).
  const { user, loading, logout } = useAuthUser();

  const onCleanPath = CLEAN_PATHS.includes(pathname);
  const isClientUser = user?.role === CLIENT_ROLE;
  // Un `client` fuera del portal. Las rutas limpias quedan fuera: la landing y las páginas legales son
  // públicas, y expulsar a alguien de un aviso legal por su rol no tiene ningún sentido.
  const clientOutsidePortal =
    isClientUser && !onCleanPath && !pathname.startsWith(PORTAL_ROOT);

  useEffect(() => {
    if (loading || !clientOutsidePortal) return;
    // `replace` y no `push`: el histórico no debe guardar la ruta del estudio, o el botón Atrás
    // devuelve al cliente a la pantalla de la que se le acaba de sacar.
    router.replace(PORTAL_ROOT);
  }, [loading, clientOutsidePortal, router]);

  if (onCleanPath) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} authLoading={loading} logout={logout} />
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
            <main className="flex w-full max-w-[1400px] flex-1 flex-col mx-auto px-4 py-8">
              {clientOutsidePortal ? (
                <div className="text-slate-500">Redirigiendo a tu portal...</div>
              ) : (
                children
              )}
            </main>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
