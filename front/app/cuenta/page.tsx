"use client";

import { useState, useEffect } from "react";
import { useAuthUser } from "@/hooks/useAuthUser";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Mi Cuenta — edit profile data and change password
// ---------------------------------------------------------------------------

interface ProfileForm {
  firstName: string;
  lastName: string;
  phone: string;
}

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  repeatPassword: string;
}

/** Valida teléfono: ES nacional (9 dígitos 6-9) o internacional (+prefijo). Vacío = válido (opcional). */
function validatePhone(raw: string): string | null {
  const v = raw.trim().replace(/[\s().-]/g, "");
  if (!v) return null;
  if (/^[6-9]\d{8}$/.test(v)) return null; // España: 9 dígitos
  if (/^\+\d{8,15}$/.test(v)) return null; // Internacional (incluye +34…)
  return "Teléfono no válido. Usa 9 dígitos (España) o + seguido del prefijo internacional (ej. +44 7700 900123).";
}

export default function MiCuentaPage() {
  const { user, loading } = useAuthUser();

  // --- Profile section state ---
  const [profile, setProfile] = useState<ProfileForm>({
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [profileStatus, setProfileStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // --- Password section state ---
  const [pw, setPw] = useState<PasswordForm>({
    oldPassword: "",
    newPassword: "",
    repeatPassword: "",
  });
  const [pwStatus, setPwStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  // --- Forgot-password inline state ---
  const [sendingReset, setSendingReset] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // Populate form from user session once loaded.
  // AuthUser now includes phone and lastName — no casts needed.
  useEffect(() => {
    if (user) {
      setProfile({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        phone: user.phone ?? "",
      });
    }
  }, [user]);

  // --- Profile submit ---
  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProfileStatus(null);
    const phoneError = validatePhone(profile.phone);
    if (phoneError) {
      setProfileStatus({ type: "error", message: phoneError });
      return;
    }
    setSavingProfile(true);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: profile.firstName.trim() || undefined,
          lastName: profile.lastName.trim() || undefined,
          phone: profile.phone.trim() || undefined,
        }),
      });
      setProfileStatus({ type: "success", message: "Datos guardados correctamente." });
    } catch (err: unknown) {
      const anyErr = err as { body?: { error?: { message?: string } }; message?: string };
      const msg = anyErr?.body?.error?.message ?? anyErr?.message ?? "No se pudo guardar";
      setProfileStatus({ type: "error", message: msg });
    } finally {
      setSavingProfile(false);
    }
  }

  // --- Password submit (server-side via /api/auth/change-password — NEVER signInWithPassword in browser) ---
  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus(null);

    if (pw.newPassword !== pw.repeatPassword) {
      setPwStatus({ type: "error", message: "Las contraseñas nuevas no coinciden." });
      return;
    }

    setSavingPw(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          oldPassword: pw.oldPassword,
          newPassword: pw.newPassword,
          repeatPassword: pw.repeatPassword,
        }),
      });
      setPwStatus({ type: "success", message: "Contraseña actualizada correctamente." });
      setPw({ oldPassword: "", newPassword: "", repeatPassword: "" });
    } catch (err: unknown) {
      const anyErr = err as { body?: { error?: { code?: string; message?: string } }; message?: string };
      const code = anyErr?.body?.error?.code;
      const msg =
        code === "wrong_password"
          ? "La contraseña actual es incorrecta."
          : code === "mismatch"
          ? "Las contraseñas nuevas no coinciden."
          : code === "weak_password"
          ? anyErr?.body?.error?.message ?? "La contraseña no cumple la política (mín. 12 caracteres, con letra y número)."
          : anyErr?.body?.error?.message ?? "No se pudo cambiar la contraseña.";
      setPwStatus({ type: "error", message: msg });
    } finally {
      setSavingPw(false);
    }
  }

  // --- Forgot-password inline action (POST /api/auth/forgot-password — server-side, anti-enumeration) ---
  async function handleForgotPassword() {
    if (!user?.email) return;
    setResetMsg(null);
    setSendingReset(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: user.email }),
      });
    } catch {
      // always show neutral message regardless of outcome
    } finally {
      setSendingReset(false);
      setResetMsg("Si el email existe, enviaremos instrucciones.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-slate-500 text-sm">Cargando...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl w-full space-y-8">
      {/* Header */}
      <div>
        <div className="kicker mb-2">Configuración</div>
        <h1 className="text-3xl font-extrabold text-white">Mi Cuenta</h1>
        <p className="text-sm text-slate-500 mt-1">
          Actualiza tus datos personales y cambia tu contraseña.
        </p>
      </div>

      {/* Profile section */}
      <div className="card p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-300 uppercase tracking-widest">
          Datos personales
        </h2>

        <form onSubmit={handleProfileSubmit} className="space-y-4">
          {/* Email — read only */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Correo electrónico
            </label>
            <input
              type="email"
              value={user?.email ?? ""}
              readOnly
              className="input-dark w-full opacity-60 cursor-not-allowed"
              aria-label="Correo electrónico (no editable)"
            />
            <p className="text-xs text-slate-500">El email no se puede cambiar desde aquí.</p>
          </div>

          {/* First name */}
          <div className="space-y-1">
            <label htmlFor="firstName" className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Nombre
            </label>
            <input
              id="firstName"
              type="text"
              value={profile.firstName}
              onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
              className="input-dark w-full"
              required
              minLength={1}
            />
          </div>

          {/* Last name */}
          <div className="space-y-1">
            <label htmlFor="lastName" className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Apellido
            </label>
            <input
              id="lastName"
              type="text"
              value={profile.lastName}
              onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
              className="input-dark w-full"
            />
          </div>

          {/* Phone */}
          <div className="space-y-1">
            <label htmlFor="phone" className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Teléfono
            </label>
            <input
              id="phone"
              type="tel"
              value={profile.phone}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              className="input-dark w-full"
              maxLength={30}
            />
          </div>

          {profileStatus && (
            <p
              className={`text-sm font-medium ${
                profileStatus.type === "success" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {profileStatus.message}
            </p>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={savingProfile}
              className="btn-grad disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingProfile ? "Guardando..." : "Guardar datos"}
            </button>
          </div>
        </form>
      </div>

      {/* Password section */}
      <div className="card p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-300 uppercase tracking-widest">
          Cambiar contraseña
        </h2>

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="oldPassword" className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Contraseña actual
            </label>
            <input
              id="oldPassword"
              type="password"
              value={pw.oldPassword}
              onChange={(e) => setPw((p) => ({ ...p, oldPassword: e.target.value }))}
              className="input-dark w-full"
              required
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="newPassword" className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Nueva contraseña
            </label>
            <input
              id="newPassword"
              type="password"
              value={pw.newPassword}
              onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))}
              className="input-dark w-full"
              required
              autoComplete="new-password"
              minLength={12}
            />
            <p className="text-xs text-slate-500">Mínimo 12 caracteres, con al menos una letra y un número.</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="repeatPassword" className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Repetir nueva contraseña
            </label>
            <input
              id="repeatPassword"
              type="password"
              value={pw.repeatPassword}
              onChange={(e) => setPw((p) => ({ ...p, repeatPassword: e.target.value }))}
              className="input-dark w-full"
              required
              autoComplete="new-password"
              minLength={12}
            />
          </div>

          {pwStatus && (
            <p
              className={`text-sm font-medium ${
                pwStatus.type === "success" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {pwStatus.message}
            </p>
          )}

          <div className="pt-2 flex items-center justify-between flex-wrap gap-3">
            <button
              type="submit"
              disabled={savingPw}
              className="btn-grad disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingPw ? "Cambiando..." : "Cambiar contraseña"}
            </button>

            {/* Forgot-password: inline button → POST /api/auth/forgot-password (server-side).
                Neutral message regardless of whether the email exists (anti-enumeration). */}
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={sendingReset || !user?.email}
              className="text-xs text-neon-cyan hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendingReset ? "Enviando..." : "No recuerdo mi contraseña"}
            </button>
          </div>

          {resetMsg && (
            <p className="text-xs text-slate-400 mt-1">{resetMsg}</p>
          )}
        </form>
      </div>
    </div>
  );
}
