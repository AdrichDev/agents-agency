"use client";

// Montaje global del widget de Telegram: vive en el root layout y aparece en todas
// las páginas autenticadas de la consola. Se oculta:
//  - En la landing pública "/" y en las páginas legales (públicas, sin chrome) —
//    igual que AppShell, que solo pinta el chrome del dashboard en esas rutas.
//  - Sin sesión Supabase: el back exige Bearer en /api/channels/* y un chip que
//    siempre falla no aporta nada. Solo se comprueba la sesión (sin red), no el
//    perfil, para no duplicar el GET /api/auth/me que ya hace la Sidebar.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import TelegramWidget from "@/components/telegram/TelegramWidget";
import { PORTAL_ROOT } from "@/lib/portal";

/** Rutas públicas sin chrome donde el widget no debe aparecer. */
const HIDDEN_PATHS = ["/", "/privacidad", "/aviso-legal", "/cookies"];

export default function TelegramWidgetGlobal() {
  const pathname = usePathname() ?? "";
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)));
    // Solo actualiza estado dentro del callback (nunca supabase.auth.* — deadlock del
    // LockManager, ver useAuthUser).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setHasSession(Boolean(session)));
    return () => subscription.unsubscribe();
  }, []);

  // H5: fuera del portal. El widget es el centro de mando del estudio y sus llamadas van a
  // `/api/channels/*`, que la puerta `clientScopeGate` le niega a un `client`: dejarlo montado sería
  // un botón flotante que sólo sabe devolver 403. Se decide por ruta y no por rol, igual que el resto
  // de este componente, para no añadir un segundo `GET /api/auth/me`.
  //
  // Consecuencia conocida y aceptada: `/api/operator-chat` exige rol `admin` en el montaje del back,
  // así que un `editor` o un `viewer` vería el widget y recibiría 403 al usarlo. Se acepta porque
  // `useAuthUser` no cachea —cada consumidor dispara su propio `GET /api/auth/me`— y hoy no existe
  // ningún usuario de staff que no sea admin. Si algún día se crean, esto pasa a ser un botón muerto
  // y toca ocultarlo por rol.
  if (HIDDEN_PATHS.includes(pathname) || pathname.startsWith(PORTAL_ROOT) || !hasSession) {
    return null;
  }
  return <TelegramWidget />;
}
