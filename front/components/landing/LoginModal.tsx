"use client";
// Login modal — uses Supabase Auth signInWithPassword (via session.ts).
// POST /api/auth/login was removed (returns 410 from the back since Phase 4).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { login } from "@/lib/auth/session";

/** Destino por defecto cuando no hay `returnTo` utilizable. */
const DEFAULT_DESTINATION = "/dashboard";

/**
 * Valida el `returnTo` que puso `lib/api.ts` al expulsar por 401.
 *
 * SEGURIDAD (redirección abierta): el parámetro viaja en la URL, así que lo controla quien mande
 * el enlace. Sólo se acepta una ruta relativa de este mismo origen: un `/` inicial y NUNCA dos
 * (`//evil.com` es un URL protocol-relative que el navegador resuelve a otro host), ni un
 * esquema completo. Ante cualquier duda, al dashboard.
 */
/**
 * Lee `returnTo` de la URL actual.
 *
 * A propósito NO se usa `useSearchParams`: en el App Router obliga a envolver el componente en un
 * límite de Suspense o el build falla, y este dato sólo hace falta dentro del submit, que ya corre
 * en el cliente. `window` está garantizado ahí.
 */
function readReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("returnTo");
}

function safeDestination(returnTo: string | null): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return DEFAULT_DESTINATION;
  // `\` lo normalizan algunos navegadores a `/`, así que `/\evil.com` también sería externo.
  if (returnTo.startsWith("/\\")) return DEFAULT_DESTINATION;
  return returnTo;
}

export default function LoginModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
      setEmail("");
      setPassword("");
      onSuccess();
      onClose();
      // Volver a donde estaba el usuario antes de que el 401 lo expulsara, no siempre al
      // dashboard. `lib/api.ts` deja el `returnTo` en la URL al redirigir aquí.
      router.push(safeDestination(readReturnTo()));
    } catch (err: any) {
      setError(err?.message ?? "Credenciales incorrectas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        data-testid="login-modal"
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0b12] p-8 shadow-[0_0_60px_rgba(157,0,255,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-16 -right-16 w-44 h-44 bg-[var(--neon-purple)]/30 rounded-full blur-[70px] pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-44 h-44 bg-[var(--neon-blue)]/30 rounded-full blur-[70px] pointer-events-none" />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-500 hover:text-white transition"
          aria-label="Cerrar"
        >
          ✕
        </button>

        <h2 className="relative text-xl font-extrabold text-white mb-1">Iniciar sesión</h2>
        <p className="relative text-xs text-slate-500 mb-6">
          Accede al panel de 3A Estudio con tus credenciales.
        </p>

        <form onSubmit={submit} className="relative space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            className="input-dark w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <div className="relative w-full">
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder="Contraseña"
              className="input-dark w-full pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-300"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="btn-neon w-full">
            {loading ? "Entrando..." : "Entrar →"}
          </button>
        </form>
      </div>
    </div>
  );
}
