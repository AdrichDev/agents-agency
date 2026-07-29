"use client";

import { useEffect, useState } from "react";
import { API, api } from "@/lib/api";
import { useDialogs } from "@/components/ui/ConfirmProvider";
import { AgentStatusChip } from "@/components/agents/AgentStatusChip";

const PALETTE = ["#4f46e5", "#9333ea", "#0f766e", "#dc2626", "#f59e0b", "#111827"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Estado de conexión de canales (Telegram / WhatsApp) ──────────────────────
interface ConnectionInfo {
  provider: string;
  status: string;
  botUsername?: string;
  botName?: string;
  phoneNumberIdMasked?: string;
}
interface StatusResponse {
  publicUrlConfigured: boolean;
  connections: ConnectionInfo[];
}

/** Fecha relativa breve en español (para "último visto" del ping del widget). */
function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString("es-ES");
}

// Píldora de estado reutilizable (verde = listo, ámbar = pendiente).
function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        ok
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-amber-400/40 bg-amber-400/10 text-amber-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
      {label}
    </span>
  );
}

// "Lo hace el cliente" vs "Lo hace la agencia" — deja claro quién implementa cada canal.
function OwnerTag({ who }: { who: "cliente" | "agencia" }) {
  return (
    <span className="rounded-full border border-edge bg-black/30 px-2 py-0.5 text-[11px] text-slate-400">
      {who === "cliente" ? "Lo instala el cliente" : "La conecta la agencia"}
    </span>
  );
}

/**
 * aa-puesta-en-marcha-agente (T5.1) — Los cuatro escalones de la puesta en marcha.
 *
 * El backend los calcula (`lib/agent/onboarding.ts`) y los sirve tanto en el listado como
 * en el detalle. Aquí sólo se pintan y se ofrece UNA acción: la siguiente. Ofrecer las
 * cuatro a la vez es lo que ha tenido a diez agentes parados en borrador siete semanas.
 */
const ONBOARDING_ROWS: { key: "configurado" | "publicado" | "alcanzable" | "probado"; label: string; hint: string }[] = [
  { key: "configurado", label: "Configurado", hint: "Tiene cliente asignado y personalidad." },
  { key: "publicado", label: "Publicado", hint: "Atiende al público y entra en la facturación." },
  { key: "alcanzable", label: "Alcanzable", hint: "El widget está instalado o hay un canal conectado." },
  // "Ha recibido tráfico", nunca "lo ha usado un cliente": lo único que sabemos es que
  // hubo una conversación fuera de la consola de pruebas. Puede ser el propio operador
  // probando el widget desde la web del cliente.
  { key: "probado", label: "Ha recibido tráfico", hint: "Alguien de fuera le ha escrito ya." },
];

export default function DeployPanel({
  agent,
  onChange,
  onGoToTab,
}: {
  agent: any;
  onChange: () => void;
  /** Cambia de pestaña en la ficha. Opcional: el panel funciona sin ella. */
  onGoToTab?: (tab: string) => void;
}) {
  const [copied, setCopied] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [channels, setChannels] = useState<StatusResponse | null>(null);
  const [config, setConfig] = useState({
    widgetPrimaryColor: agent.widgetPrimaryColor ?? "#4f46e5",
    widgetSecondaryColor: agent.widgetSecondaryColor ?? "#9333ea",
    widgetAvatarEmoji: agent.widgetAvatarEmoji ?? "🤖",
    widgetAvatarBase64: agent.widgetAvatarBase64 ?? "",
    widgetTemplateConfig: {
      position: agent.widgetTemplateConfig?.position ?? "right",
      launcherShape: agent.widgetTemplateConfig?.launcherShape ?? "circle",
      panelSize: agent.widgetTemplateConfig?.panelSize ?? "normal",
    },
  });
  // Solo enviamos el avatar si el usuario lo cambió: un agente migrado tiene
  // base64="" (la imagen vive en Storage como URL) → enviar "" lo borraría.
  const [avatarTouched, setAvatarTouched] = useState(false);
  // Desplegable de canales adicionales (los NO elegidos): accesibles pero
  // de-enfatizados, para poder publicar el agente en un segundo canal.
  const [extraOpen, setExtraOpen] = useState(false);
  // H3 (aa-agente-ciclo-vida-publicacion, T5.1): publicar/despublicar.
  const [publishing, setPublishing] = useState(false);
  const { confirm, notify } = useDialogs();

  // Estado real de conexión de Telegram/WhatsApp (no "próximamente"): lo lee del
  // mismo endpoint que el panel de Canales. Best-effort: si falla, se muestran
  // como pendientes en vez de romper la vista.
  async function loadChannels() {
    try {
      const data = await api<StatusResponse>(`/api/channels/${agent.id}/status`);
      setChannels(data);
    } catch {
      setChannels({ publicUrlConfigured: false, connections: [] });
    }
  }
  useEffect(() => {
    void loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const snippet = `<script src="${API}/widget.js" data-agent-key="${agent.publicKey}"></script>`;
  const curl = `curl -X POST ${API}/api/chat \\
  -H "Content-Type: application/json" \\
  -d '{"publicKey": "${agent.publicKey}", "message": "Hola"}'`;

  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1500);
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const payload: any = {
        widgetPrimaryColor: config.widgetPrimaryColor,
        widgetSecondaryColor: config.widgetSecondaryColor,
        widgetAvatarEmoji: config.widgetAvatarEmoji,
        widgetTemplateConfig: config.widgetTemplateConfig,
      };
      if (avatarTouched) payload.widgetAvatarBase64 = config.widgetAvatarBase64 || null;
      await api(`/api/agents/${agent.id}/widget-config`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setStatus("Configuración guardada");
      onChange();
    } catch {
      setStatus("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function setImage(file?: File) {
    if (!file) return;
    if (file.size > 300_000) {
      setStatus("Imagen demasiado grande (máx. 300 KB) — usa una más pequeña");
      return;
    }
    const widgetAvatarBase64 = await fileToBase64(file);
    setConfig((current) => ({ ...current, widgetAvatarBase64 }));
    setAvatarTouched(true);
  }

  // Re-comprueba el estado (recarga el detalle del agente → badge de instalación
  // del widget) y el estado de los canales.
  async function recheck() {
    if (checking) return;
    setChecking(true);
    try {
      await Promise.all([Promise.resolve(onChange()), loadChannels()]);
    } finally {
      setChecking(false);
    }
  }

  // ── Publicación (H3 aa-agente-ciclo-vida-publicacion, T5.1) ────────────────
  // Publicar vive aquí y no en el formulario de configuración porque es una acción, no un
  // campo: es el instante en que el agente empieza a atender al público y a facturar. Antes
  // de este change ese instante era el alta, y no lo decidía nadie.
  // `agentStatus`, no `status`: en este componente `status` ya es el mensaje del guardado de
  // apariencia. Dos cosas distintas con el mismo nombre.
  const agentStatus: string = agent.status ?? "";
  const published = agentStatus === "published";
  // Las calcula el back con la misma función que decide el 400 de POST /publish
  // (`checkPublishPreconditions`). Aquí sólo se pintan.
  const precond = (agent.publishPreconditions ?? { blocking: [], warnings: [] }) as {
    blocking: string[];
    warnings: string[];
  };
  // Sólo `draft` ⇄ `published` se cambia desde aquí: `suspended` lo pone la plataforma por
  // impago y `archived` es una retirada. Ninguno de los dos se levanta con este botón.
  // aa-puesta-en-marcha-agente (T5.1). Opcional: si el backend es anterior a T2 (o la
  // respuesta viene cacheada) el checklist no se pinta, en vez de inventarse escalones.
  const onboarding = agent.onboarding as
    | {
        configurado: boolean;
        publicado: boolean;
        alcanzable: boolean;
        probado: boolean;
        nextLabel: string | null;
        nextTab: "ajustes" | "canales" | "implementacion" | null;
      }
    | null
    | undefined;
  const canToggle = agentStatus === "draft" || published;
  const blocked = !published && precond.blocking.length > 0;

  const STATUS_COPY: Record<string, string> = {
    published:
      "Atiende al público en su canal y cuenta como agente activo en la facturación del cliente.",
    draft:
      "Todavía no atiende al público: el widget, la API y las reservas responden que no está publicado. Puedes probarlo desde la consola de pruebas.",
    suspended:
      "La plataforma lo ha desactivado. Sigue contando en la facturación: contacta con soporte para reactivarlo.",
    archived: "Retirado. Se conserva su historial de facturación.",
  };

  async function togglePublished() {
    if (publishing) return;
    const ok = await confirm(
      published
        ? {
            title: "Despublicar agente",
            message:
              "El agente dejará de atender al público de inmediato: widget, API y reservas responderán que no está publicado. Seguirás pudiendo probarlo desde la consola y volver a publicarlo cuando quieras.",
            confirmText: "Despublicar",
            danger: true,
          }
        : {
            title: "Publicar agente",
            message:
              "El agente empezará a atender al público y a contar como agente activo en la facturación del cliente.",
            confirmText: "Publicar",
          }
    );
    if (!ok) return;
    setPublishing(true);
    try {
      const res = await api<{ warnings?: string[] }>(
        `/api/agents/${agent.id}/${published ? "unpublish" : "publish"}`,
        { method: "POST" }
      );
      // Avisos de T3.1 (canal de mensajería declarado sin conexión): se publica, pero el
      // cliente no recibe por donde creía haber comprado. Tragárselos daría un "publicado"
      // limpio a un agente que no atiende por su canal.
      if (res?.warnings?.length) {
        await notify(res.warnings.join(" "), { title: "Publicado, con avisos" });
      }
      onChange();
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "No se pudo cambiar el estado.";
      await notify(msg, { tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  const renderPublication = () => (
    <div className="card p-5 space-y-3 border-[var(--neon-purple)]/40">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="kicker">Estado</span>
          <AgentStatusChip status={agent.status} />
          {published && agent.publishedAt && (
            <span className="text-xs text-slate-500">
              publicado desde {new Date(agent.publishedAt).toLocaleDateString("es-ES")}
            </span>
          )}
        </div>
        {canToggle && (
          <button
            type="button"
            onClick={togglePublished}
            disabled={publishing || blocked}
            title={blocked ? "Faltan datos obligatorios: los tienes debajo." : undefined}
            className={
              published
                ? "rounded-full border border-edge px-4 py-1.5 text-xs text-slate-300 hover:text-white disabled:opacity-60"
                : "btn-grad !px-4 !py-1.5 !text-xs disabled:opacity-60"
            }
          >
            {publishing ? "Guardando…" : published ? "Despublicar" : "Publicar"}
          </button>
        )}
      </div>

      <p className="text-xs text-slate-500">{STATUS_COPY[agentStatus] ?? "Estado no reconocido."}</p>

      {/* Bloqueantes: se enumeran porque un "faltan datos" obliga a adivinar cuáles. */}
      {blocked && (
        <div className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2">
          <p className="text-xs font-semibold text-rose-300">Para publicar falta:</p>
          <ul className="mt-1 space-y-0.5 text-xs text-rose-200/90 list-disc list-inside">
            {precond.blocking.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Avisos: no impiden publicar, pero se dicen antes de pulsar, no después. */}
      {!published && precond.warnings.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 list-disc list-inside">
          {precond.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {onboarding && (
        <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-3">
          <p className="kicker mb-2">Puesta en marcha</p>
          <ol className="space-y-1.5">
            {ONBOARDING_ROWS.map((row) => {
              const done = Boolean(onboarding[row.key]);
              return (
                <li key={row.key} className="flex items-start gap-2 text-xs">
                  <span
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] ${
                      done
                        ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                        : "border-slate-600 text-slate-600"
                    }`}
                    aria-hidden
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span className={done ? "text-slate-300" : "text-slate-500"}>
                    <span className="font-semibold">{row.label}.</span> {row.hint}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* UNA sola acción: la siguiente. La decide el backend, no este componente. */}
          {onboarding.nextLabel && (
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-amber-300">{onboarding.nextLabel}</p>
              {onboarding.nextTab && onboarding.nextTab !== "implementacion" && onGoToTab && (
                <button
                  type="button"
                  onClick={() => onGoToTab(onboarding.nextTab as string)}
                  className="text-xs text-indigo-400 hover:underline shrink-0"
                >
                  {onboarding.nextTab === "ajustes" ? "Ir a Ajustes →" : "Ir a Canales →"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // El snippet y el curl siguen visibles en borrador —hacen falta para preparar la
  // instalación—, pero con el aviso de que aún no responden. Ocultarlos impediría
  // instalarlos antes de vender; no avisar haría perseguir un fallo que no existe.
  const notPublishedNotice = !published ? (
    <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
      Este código ya es el definitivo, pero mientras el agente no esté publicado responde «no
      publicado». Publícalo arriba cuando esté listo.
    </p>
  ) : null;

  const widgetInstalled = Boolean(agent.widgetInstalledAt);
  const connByProvider = (p: string) => channels?.connections.find((c) => c.provider === p);
  const tg = connByProvider("telegram");
  const wa = connByProvider("whatsapp");
  const tgActive = tg?.status === "active";
  const waActive = wa?.status === "active" || wa?.status === "pending"; // WA queda "pending" tras conectar (verify de Meta)

  // ── Canal elegido (fuente de verdad: agent.channel, solo lectura) ──────────
  // Gobierna QUÉ sección se muestra en primer plano. Los canales no elegidos
  // quedan accesibles bajo el desplegable "¿Publicar también en otro canal?".
  const channel: string = agent.channel || "widget";
  // ── Visibilidad de "Comprobar estado" (F2) ────────────────────────────────
  // Solo tiene sentido comprobar el estado de Telegram/WhatsApp si hay al menos
  // una conexión de mensajería ya registrada, o si el canal elegido del agente
  // es telegram/whatsapp (aún sin conectar). En un agente widget/api sin
  // conexiones no hay nada que comprobar → se oculta el botón.
  const hasMessagingConnections = Boolean(channels?.connections?.length);
  const isMessagingChannel = channel === "telegram" || channel === "whatsapp";
  const showStatusCheck = hasMessagingConnections || isMessagingChannel;
  const channelLabel = (c: string) =>
    c === "widget"
      ? "Widget web"
      : c === "telegram"
        ? "Telegram"
        : c === "whatsapp"
          ? "WhatsApp"
          : "API REST";

  // Editor de apariencia del widget: SOLO acompaña a la sección Widget (sea
  // principal o añadida desde el desplegable), nunca suelto.
  const renderWidgetAppearance = () => (
    <div className="card p-5 space-y-4">
      <h3 className="font-semibold text-sm text-white">Apariencia del widget</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(["widgetPrimaryColor", "widgetSecondaryColor"] as const).map((key) => (
          <label key={key} className="text-xs text-slate-500">
            {key === "widgetPrimaryColor" ? "Color primario" : "Color secundario"}
            <div className="flex gap-2 mt-1">
              <input
                className="input-dark"
                value={config[key]}
                onChange={(e) => setConfig((current) => ({ ...current, [key]: e.target.value }))}
              />
              <input
                type="color"
                value={config[key].startsWith("#") ? config[key] : "#4f46e5"}
                onChange={(e) => setConfig((current) => ({ ...current, [key]: e.target.value }))}
                className="h-10 w-12 rounded bg-transparent"
              />
            </div>
          </label>
        ))}
      </div>
      <div className="space-y-2">
        {(["widgetPrimaryColor", "widgetSecondaryColor"] as const).map((key) => (
          <div key={key} className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 w-24">
              {key === "widgetPrimaryColor" ? "Paleta 1º" : "Paleta 2º"}
            </span>
            {PALETTE.map((color) => (
              <button
                key={color}
                title={color}
                onClick={() => setConfig((current) => ({ ...current, [key]: color }))}
                className={`h-7 w-7 rounded-full border transition ${
                  config[key] === color ? "border-white scale-110" : "border-white/20"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          className="input-dark"
          value={config.widgetAvatarEmoji}
          onChange={(e) => setConfig((current) => ({ ...current, widgetAvatarEmoji: e.target.value }))}
        />
        <select
          className="input-dark"
          value={config.widgetTemplateConfig.position}
          onChange={(e) =>
            setConfig((current) => ({
              ...current,
              widgetTemplateConfig: { ...current.widgetTemplateConfig, position: e.target.value },
            }))
          }
        >
          <option value="right">Derecha</option>
          <option value="left">Izquierda</option>
        </select>
        <select
          className="input-dark"
          value={config.widgetTemplateConfig.launcherShape}
          onChange={(e) =>
            setConfig((current) => ({
              ...current,
              widgetTemplateConfig: { ...current.widgetTemplateConfig, launcherShape: e.target.value },
            }))
          }
        >
          <option value="circle">Circular</option>
          <option value="rounded">Redondeado</option>
        </select>
        <select
          className="input-dark"
          value={config.widgetTemplateConfig.panelSize}
          onChange={(e) =>
            setConfig((current) => ({
              ...current,
              widgetTemplateConfig: { ...current.widgetTemplateConfig, panelSize: e.target.value },
            }))
          }
        >
          <option value="compact">Compacto</option>
          <option value="normal">Normal</option>
          <option value="wide">Ancho</option>
        </select>
      </div>
      <input className="input-dark" type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0])} />
      {(config.widgetAvatarBase64 || agent.widgetAvatarUrl) && (
        <img src={config.widgetAvatarBase64 || agent.widgetAvatarUrl} alt="Avatar widget" className="h-14 w-14 rounded-full object-cover" />
      )}
      <button onClick={save} disabled={saving} className="btn-grad !px-3 !py-1.5 !text-xs">
        {saving ? "Guardando..." : "Guardar apariencia"}
      </button>
      {status && <p className="text-xs text-slate-400">{status}</p>}
    </div>
  );

  // Widget web: snippet + guía de instalación + estado, y el editor de apariencia.
  const renderWidget = () => (
    <>
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-white">Widget web (chatbot embebido)</h3>
          <div className="flex items-center gap-2">
            <OwnerTag who="cliente" />
            <StatusPill
              ok={widgetInstalled}
              label={
                widgetInstalled
                  ? `Instalado ✓ · visto ${relativeTime(agent.widgetLastSeenAt)}`
                  : "Pendiente de instalación"
              }
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Pega este snippet antes de <code className="bg-black/40 px-1 rounded">{"</body>"}</code> en la web del
          cliente. Aparece una burbuja de chat flotante.
        </p>
        {notPublishedNotice}
        <pre className="bg-black/50 border border-edge text-slate-300 text-xs p-4 rounded-xl overflow-x-auto">{snippet}</pre>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => copy(snippet, "widget")} className="btn-grad !px-3 !py-1.5 !text-xs">
            {copied === "widget" ? "Copiado" : "Copiar snippet"}
          </button>
          <button
            onClick={() => setGuideOpen((v) => !v)}
            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
          >
            {guideOpen ? "Ocultar guía de instalación" : "¿Cómo lo instala el cliente?"}
          </button>
        </div>
        {guideOpen && (
          <ol className="mt-1 space-y-1.5 text-xs text-slate-400 list-decimal list-inside">
            <li>Copia el snippet de arriba.</li>
            <li>
              Pégalo justo antes de <code className="bg-black/40 px-1 rounded">{"</body>"}</code> en el HTML de la web
              (o en el bloque de «código personalizado / footer» del gestor: WordPress, Shopify, Wix, etc.).
            </li>
            <li>Publica los cambios y recarga la página del sitio.</li>
            <li>Aparecerá la burbuja de chat. Al cargarse, esta ficha pasa sola a «Instalado ✓».</li>
          </ol>
        )}
        {!widgetInstalled && (
          <p className="text-[11px] text-slate-500">
            Aún no hemos recibido ninguna carga del widget. Si ya lo pegaste, abre la web del cliente y pulsa
            «Comprobar estado».
          </p>
        )}
      </div>
      {renderWidgetAppearance()}
    </>
  );

  // API REST: siempre disponible, se elija el canal que se elija (publicKey).
  const renderApi = () => (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm text-white">API REST (integración programática)</h3>
        <OwnerTag who="cliente" />
      </div>
      <p className="text-xs text-slate-500">
        Llama al agente desde cualquier backend, app web o móvil con la clave pública del agente.{" "}
        <span className="text-slate-400">
          Disponible siempre, se elija el canal que se elija.
        </span>
      </p>
      {notPublishedNotice}
      <pre className="bg-black/50 border border-edge text-slate-300 text-xs p-4 rounded-xl overflow-x-auto">{curl}</pre>
      <button onClick={() => copy(curl, "api")} className="btn-grad !px-3 !py-1.5 !text-xs">
        {copied === "api" ? "Copiado" : "Copiar ejemplo"}
      </button>
    </div>
  );

  const renderTelegram = () => (
    <div className="card p-5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm text-white">Telegram (bot de mensajería)</h3>
        <div className="flex items-center gap-2">
          <OwnerTag who="agencia" />
          <StatusPill
            ok={tgActive}
            label={tgActive ? `Conectado${tg?.botUsername ? ` · @${tg.botUsername}` : ""}` : "Pendiente de conexión"}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {tgActive
          ? "El bot está activo y recibe mensajes. No hay nada más que hacer en el sitio del cliente."
          : "La agencia conecta el bot con un token de @BotFather desde la pestaña «Canales e integraciones». Una vez conectado, aquí figurará como activo."}
      </p>
    </div>
  );

  const renderWhatsapp = () => (
    <div className="card p-5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm text-white">WhatsApp (bot de mensajería)</h3>
        <div className="flex items-center gap-2">
          <OwnerTag who="agencia" />
          <StatusPill ok={waActive} label={waActive ? "Conectado" : "Pendiente de conexión"} />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {waActive
          ? "El número está vinculado vía Meta Cloud API y recibe mensajes."
          : "La agencia conecta el número con credenciales de Meta Cloud API (phone number ID y access token) desde «Canales e integraciones»."}
      </p>
    </div>
  );

  const renderChannel = (c: string) =>
    c === "widget"
      ? renderWidget()
      : c === "telegram"
        ? renderTelegram()
        : c === "whatsapp"
          ? renderWhatsapp()
          : renderApi();

  // Canales de mensajería/widget NO elegidos → desplegable de-enfatizado. La API
  // nunca entra aquí: es una sección siempre visible aparte.
  const otherChannels = ["widget", "telegram", "whatsapp"].filter((c) => c !== channel);

  return (
    <div className="space-y-5">
      {/* H3/T5.1: primero el estado. Lo de abajo (snippet, curl, canales) sólo responde si
          el agente está publicado, así que enterarse al final sería enterarse tarde. */}
      {renderPublication()}

      <div className="card p-5 border-[var(--neon-purple)]/40">
        <div className="kicker mb-1">Implementación / entrega</div>
        <h3 className="font-semibold text-sm text-white mb-1">Pon el agente a funcionar en su canal</h3>
        <p className="text-xs text-slate-500">
          Este agente se publica en <strong className="text-slate-300">{channelLabel(channel)}</strong> (el canal que
          elegiste). Abajo tienes primero ese canal; la <strong className="text-slate-300">API REST</strong> está
          siempre disponible. Si quieres publicarlo también en otro canal, lo encontrarás en el desplegable del final.
        </p>
        {showStatusCheck && (
          <button
            onClick={recheck}
            disabled={checking}
            className="mt-3 rounded-full border border-edge px-3 py-1.5 text-xs text-slate-300 hover:text-white disabled:opacity-60"
          >
            {checking ? "Comprobando…" : "Comprobar estado ⟳"}
          </button>
        )}
      </div>

      {/* ── Canal principal (agent.channel) — prominente ─────────────────────── */}
      <div className="space-y-5 rounded-2xl border border-[var(--neon-purple)]/40 bg-[var(--neon-purple)]/5 p-3">
        <div className="flex items-center gap-2 px-2">
          <span className="kicker">Canal principal</span>
          <span className="rounded-full border border-[var(--neon-purple)]/50 bg-[var(--neon-purple)]/15 px-2 py-0.5 text-[11px] text-slate-200">
            {channelLabel(channel)}
          </span>
        </div>
        {renderChannel(channel)}
      </div>

      {/* ── API REST — siempre visible (salvo si ya es el canal principal) ───── */}
      {channel !== "api" && renderApi()}

      {/* ── Otros canales — de-enfatizados bajo desplegable (no se eliminan) ─── */}
      {otherChannels.length > 0 && (
        <div className="card p-5 space-y-3">
          <button
            onClick={() => setExtraOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="font-semibold text-sm text-white">¿Publicar también en otro canal?</span>
            <span className="text-xs text-slate-500">{extraOpen ? "Ocultar ▲" : "Mostrar ▼"}</span>
          </button>
          <p className="text-xs text-slate-500">
            El agente ya funciona en {channelLabel(channel)} y por API. Si además quieres publicarlo en otro canal,
            actívalo aquí (Widget, Telegram o WhatsApp).
          </p>
          {extraOpen && <div className="space-y-5 pt-1">{otherChannels.map((c) => <div key={c}>{renderChannel(c)}</div>)}</div>}
        </div>
      )}
    </div>
  );
}
