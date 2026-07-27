"use client";

/**
 * H5 (aa-portal-cliente, T4.1) — Portal del cliente: qué tiene contratado y cuánto le queda.
 *
 * Sólo lectura. No hay ni un botón que escriba: el portal de H5 enseña el servicio, no lo administra.
 *
 * Dos cosas que esta pantalla NO hace, y son deliberadas:
 *
 * - **No calcula el cupo.** El cupo, el restante y el nivel de aviso vienen resueltos del backend con
 *   la misma función que usa el gate para cortar. Si esta página hiciera su propia cuenta, existiría un
 *   consumo exacto en el que dice "te queda saldo" mientras el asistente ya devuelve 402.
 * - **No inventa precios.** El importe sale del catálogo comercial cruzando `plan.codigo`; si el plan
 *   no está en el catálogo (hoy: la tabla `plan` está vacía), no se muestra tarifa. Un número
 *   aproximado en la pantalla del cliente es peor que ninguno.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { TOKENS_PER_MESSAGE } from "@/components/clientes/types";
import {
  conIva,
  porcentajeConsumido,
  tarifaDePlan,
  textoAviso,
  textoRenovacion,
  type PortalAgent,
  type PortalMe,
} from "@/lib/portal";

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-edge bg-white/[0.02] p-6 ${className}`}
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Barra de consumo. El color sigue los mismos umbrales que el aviso del backend. */
function QuotaBar({ percent, warning }: { percent: number; warning: string | null }) {
  const color =
    warning === "exhausted" || warning === "warn90"
      ? "bg-red-500"
      : warning === "warn75"
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <div
      className="h-2 w-full rounded-full bg-white/10 overflow-hidden"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${color} transition-all`} style={{ width: `${percent}%` }} />
    </div>
  );
}

export default function PortalPage() {
  const [me, setMe] = useState<PortalMe | null>(null);
  const [agents, setAgents] = useState<PortalAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<PortalMe>("/api/portal/me"), api<PortalAgent[]>("/api/portal/agents")])
      .then(([meData, agentsData]) => {
        if (cancelled) return;
        setMe(meData);
        setAgents(agentsData);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "No se pudo cargar tu portal");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-300">
        {error}
      </div>
    );
  }

  if (!me || !agents) {
    return <div className="text-slate-500">Cargando tu portal...</div>;
  }

  const tarifa = tarifaDePlan(me.plan?.codigo);
  const byok = me.credentialMode === "byok";
  const { tokenQuota, remaining, tokensUsedPeriod, warning } = me.usage;
  const uncapped = tokenQuota === null;
  const percent = porcentajeConsumido(me.usage);
  const aviso = byok ? null : textoAviso(warning);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">{me.tenant.name}</h1>
        <p className="text-sm text-slate-500">Tu servicio de asistentes de IA</p>
      </header>

      {/* Suscripción impagada o cortada por el estudio: es lo primero que hay que leer, porque
          explica por qué el asistente no responde aunque quede cupo. */}
      {!me.tenant.isActive && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          Tu servicio está desactivado. Los asistentes no responden. Contacta con el estudio.
        </div>
      )}

      {aviso && (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            warning === "warn75"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {aviso}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Plan contratado">
          <p className="text-lg font-semibold text-white">
            {me.plan?.nombre ?? tarifa?.name ?? "Plan a medida"}
          </p>
          {tarifa ? (
            <>
              <p className="mt-1 text-sm text-slate-400">{tarifa.description}</p>
              <p className="mt-4 font-mono text-2xl font-bold text-neon-cyan">
                {conIva(tarifa.maintPrice).toLocaleString("es-ES", {
                  style: "currency",
                  currency: "EUR",
                })}
                <span className="ml-2 text-xs font-normal text-slate-500">/ mes, IVA incluido</span>
              </p>
            </>
          ) : (
            // Sin entrada en el catálogo no hay importe que enseñar. Se dice, no se rellena.
            <p className="mt-4 text-sm text-slate-500">
              Consulta la cuota de mantenimiento con el estudio.
            </p>
          )}
          <p className="mt-4 text-xs text-slate-500">
            {me.billableAgents}{" "}
            {me.billableAgents === 1 ? "asistente activo" : "asistentes activos"}
          </p>
        </Card>

        <Card title="Consumo del mes">
          {byok ? (
            // En byok el cliente paga su propio LLM: no hay cupo que consumir, así que enseñar un
            // porcentaje sería medir contra un techo que no existe.
            <>
              <p className="text-lg font-semibold text-sky-400">Clave propia</p>
              <p className="mt-2 text-sm text-slate-400">
                El consumo de IA se factura en tu proveedor. Aquí no se aplica cupo.
              </p>
              <p className="mt-4 font-mono text-sm text-slate-400">
                {tokensUsedPeriod.toLocaleString("es-ES")} tokens este periodo
              </p>
            </>
          ) : uncapped ? (
            <>
              <p className="text-lg font-semibold text-emerald-400">Sin límite</p>
              <p className="mt-2 font-mono text-sm text-slate-400">
                {tokensUsedPeriod.toLocaleString("es-ES")} tokens consumidos
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-3xl font-bold text-white">
                {(remaining ?? 0).toLocaleString("es-ES")}
                <span className="ml-2 text-xs font-normal text-slate-500">tokens restantes</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                ~{Math.floor((remaining ?? 0) / TOKENS_PER_MESSAGE).toLocaleString("es-ES")}{" "}
                mensajes aproximados
              </p>
              <div className="mt-4">
                <QuotaBar percent={percent ?? 0} warning={warning} />
                <p className="mt-2 text-xs text-slate-500">
                  {tokensUsedPeriod.toLocaleString("es-ES")} de{" "}
                  {(tokenQuota ?? 0).toLocaleString("es-ES")} tokens ({percent ?? 0}%)
                </p>
              </div>
            </>
          )}
          <p className="mt-4 text-xs text-slate-500">{textoRenovacion(me.period)}</p>
        </Card>
      </div>

      <Card title="Tus asistentes">
        {agents.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todavía no tienes ningún asistente publicado.
          </p>
        ) : (
          <ul className="divide-y divide-edge">
            {agents.map((a) => (
              <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                <Link
                  href={`/portal/agentes/${a.id}`}
                  className="flex items-center justify-between gap-4 hover:opacity-80 transition"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-white">{a.name}</span>
                    <span className="block text-xs text-slate-500">
                      {a.sector ?? "sin sector"}
                      {a.channel ? ` · ${a.channel}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-4 shrink-0">
                    <span className="font-mono text-xs text-slate-400">
                      {a.tokensUsedPeriod.toLocaleString("es-ES")} tok
                    </span>
                    {/* `suspended` se dice tal cual: el asistente está vendido pero silenciado, y el
                        cliente tiene que poder ver por qué no contesta. */}
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        a.status === "published" ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {a.status === "published" ? "Activo" : "Pausado"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
