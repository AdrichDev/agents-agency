"use client";

// Montaje global del widget de Telegram: vive en el root layout y aparece en todas
// las páginas autenticadas de la consola. Se oculta:
//  - En la landing pública "/" (donde vive el login) — igual que AppShell, que solo
//    pinta el chrome del dashboard fuera de "/".
//  - Sin sesión Supabase: el back exige Bearer en /api/channels/* y un chip que
//    siempre falla no aporta nada. Solo se comprueba la sesión (sin red), no el
//    perfil, para no duplicar el GET /api/auth/me que ya hace la Sidebar.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import TelegramWidget from "@/components/telegram/TelegramWidget";

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

  if (pathname === "/" || !hasSession) return null;
  return <TelegramWidget />;
}
