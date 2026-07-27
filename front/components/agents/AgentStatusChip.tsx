/**
 * H3 (aa-agente-ciclo-vida-publicacion) — Chip de estado del agente.
 *
 * Compartido entre la tarjeta del listado y la banda del panel de despliegue: si cada sitio
 * pintase su propio criterio, el mismo estado acabaría contándose de dos formas distintas.
 *
 * Los cuatro estados y sus textos vienen de `back/src/lib/agent/lifecycle.ts`. Lo que
 * distingue a `draft` de `suspended` en la interfaz no es que estén callados —lo están
 * igual— sino quién puede cambiarlo: `draft` lo decide el propietario, `suspended` la
 * plataforma. De ahí que sólo `draft` invite a actuar.
 */

export type AgentStatus = "draft" | "published" | "suspended" | "archived";

const STYLES: Record<AgentStatus, { label: string; className: string; title: string }> = {
  published: {
    label: "Publicado",
    className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    title: "Atiende al público y se factura.",
  },
  draft: {
    label: "Borrador",
    className: "border-slate-500/40 bg-slate-500/15 text-slate-300",
    title: "No atiende al público. Puedes probarlo desde la consola.",
  },
  suspended: {
    label: "Suspendido",
    className: "border-amber-500/40 bg-amber-500/15 text-amber-300",
    title: "Desactivado por la plataforma. Sigue facturándose.",
  },
  archived: {
    label: "Archivado",
    className: "border-rose-500/40 bg-rose-500/15 text-rose-300",
    title: "Retirado. Se conserva su historial.",
  },
};

/** Estado desconocido: se muestra tal cual en vez de inventar uno. */
const UNKNOWN = {
  className: "border-slate-500/40 bg-slate-500/15 text-slate-400",
  title: "Estado no reconocido.",
};

export function AgentStatusChip({
  status,
  className = "",
}: {
  status?: string | null;
  className?: string;
}) {
  const known = status ? STYLES[status as AgentStatus] : undefined;
  const style = known ?? UNKNOWN;
  const label = known?.label ?? status ?? "Sin estado";

  return (
    <span
      title={style.title}
      className={`text-xs px-2.5 py-1 rounded-full border ${style.className} ${className}`}
    >
      {label}
    </span>
  );
}
