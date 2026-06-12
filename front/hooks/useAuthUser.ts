"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

/** Sesión actual (cookie JWT del back). user = null si no hay login. */
export function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const data = await api<{ user?: AuthUser }>("/api/auth/me");
      setUser(data?.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {}
    setUser(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  return { user, loading, refresh, logout };
}
