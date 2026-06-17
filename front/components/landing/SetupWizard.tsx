"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { getWebbotKey, injectWebbot, removeWebbot } from "./webbot";

interface AgentLite {
  id: string;
  name: string;
  publicKey: string;
  integrations?: { provider: string }[];
}

interface Props {
  projectId: string;
  files: Record<string, string>;
  dbProvider?: string;
  onApply: (files: Record<string, string>) => void;
  qrUrl: string | null;
  onQrSaved: (url: string | null) => void;
  onClose: () => void;
  initialStep?: number;
}

interface EnvField {
  key: string;
  label: string;
  placeholder: string;
}

// Campos de credenciales necesarios según la capa de datos elegida.
const ENV_FIELDS: Record<string, EnvField[]> = {
  firebase: [
    { key: "FIREBASE_API_KEY", label: "API Key", placeholder: "AIza..." },
    { key: "FIREBASE_AUTH_DOMAIN", label: "Auth Domain", placeholder: "tu-app.firebaseapp.com" },
    { key: "FIREBASE_PROJECT_ID", label: "Project ID", placeholder: "tu-app" },
    { key: "FIREBASE_STORAGE_BUCKET", label: "Storage Bucket", placeholder: "tu-app.appspot.com" },
    { key: "FIREBASE_MESSAGING_SENDER_ID", label: "Messaging Sender ID", placeholder: "123456789" },
    { key: "FIREBASE_APP_ID", label: "App ID", placeholder: "1:123:web:abc" },
  ],
  supabase: [
    { key: "SUPABASE_URL", label: "Project URL", placeholder: "https://xxxx.supabase.co" },
    { key: "SUPABASE_ANON_KEY", label: "Anon Key", placeholder: "eyJhbGci..." },
  ],
  "local-postgres": [
    { key: "API_BASE_URL", label: "URL del backend", placeholder: "https://tu-backend.com" },
  ],
  none: [],
};

/**
 * Asistente paso a paso de configuración/publicación de la landing.
 * Reabrible: actúa como "editar" — al aplicar, inyecta directamente en el código.
 * Pasos: Chatbot (con reservas vía Calendar) → QR → Resumen/credenciales.
 */
export function SetupWizard({ projectId, files, dbProvider = "none", onApply, qrUrl, onQrSaved, onClose, initialStep = 1 }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);

  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);

  const hasIndex = "index.html" in files;
  const indexHtml = files["index.html"] ?? "";
  const currentBotKey = getWebbotKey(indexHtml);
  const currentBot = agents.find((a) => a.publicKey === currentBotKey) ?? null;

  // Chatbot step state
  const [wantBot, setWantBot] = useState<boolean>(!!currentBotKey);
  const [botMode, setBotMode] = useState<"existing" | "new">("existing");
  const [selectedAgent, setSelectedAgent] = useState("");

  // QR step state
  const [wantQr, setWantQr] = useState<boolean>(!!qrUrl);
  const [qr, setQr] = useState(qrUrl ?? "");
  const [qrImg, setQrImg] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = qr.trim();
    if (!wantQr || !trimmed) { setQrImg(null); return; }
    let cancelled = false;
    QRCode.toDataURL(trimmed, { width: 512, margin: 2, errorCorrectionLevel: "M" })
      .then((d) => { if (!cancelled) setQrImg(d); })
      .catch(() => { if (!cancelled) setQrImg(null); });
    return () => { cancelled = true; };
  }, [qr, wantQr]);

  function downloadQr() {
    if (!qrImg) return;
    const a = document.createElement("a");
    a.href = qrImg;
    a.download = "landing-qr.png";
    a.click();
  }

  useEffect(() => {
    api<AgentLite[]>("/api/agents")
      .then((list) => {
        setAgents(list);
        const active = list.find((a) => a.publicKey === currentBotKey);
        setSelectedAgent(active?.id ?? list[0]?.id ?? "");
        if (active) setWantBot(true);
      })
      .catch(() => setAgents([]))
      .finally(() => setLoadingAgents(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedAgentObj = agents.find((a) => a.id === selectedAgent) ?? null;
  const selectedHasGoogle = selectedAgentObj?.integrations?.some((i) => i.provider === "google") ?? false;

  function applyBot() {
    if (!hasIndex) return;
    if (!wantBot) {
      // Quitar webbot si existía
      if (currentBotKey) onApply({ ...files, "index.html": removeWebbot(indexHtml) });
      return;
    }
    const agent = agents.find((a) => a.id === selectedAgent);
    if (agent) onApply({ ...files, "index.html": injectWebbot(indexHtml, agent.publicKey) });
  }

  function goCreateAgent() {
    const returnTo = `/landing-builder/${projectId}`;
    router.push(`/agents/new?returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function applyQr() {
    const value = wantQr ? qr.trim() || null : null;
    await api(`/api/landing/${projectId}/qr`, {
      method: "PATCH",
      body: JSON.stringify({ qrUrl: value }),
    });
    onQrSaved(value);
  }

  // --- Credenciales / .env -------------------------------------------------
  const envFields = ENV_FIELDS[dbProvider] ?? [];
  const [creds, setCreds] = useState<Record<string, string>>({});

  // Prefill desde un .env ya existente en el proyecto (KEY=VALUE por línea).
  useEffect(() => {
    const existing = files[".env"];
    if (!existing) return;
    const parsed: Record<string, string> = {};
    for (const line of existing.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) parsed[m[1]] = m[2];
    }
    setCreds(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildEnv(): string {
    const lines = [
      "# .env generado por el Landing Builder — rellena/edita y usa al desplegar.",
      "",
      `SITE_URL=${creds.SITE_URL ?? ""}`,
      `CONTACT_EMAIL=${creds.CONTACT_EMAIL ?? ""}`,
    ];
    if (currentBotKey) lines.push(`WEBBOT_PUBLIC_KEY=${currentBotKey}`);
    if (envFields.length) {
      lines.push("", `# Capa de datos: ${dbProvider}`);
      for (const f of envFields) lines.push(`${f.key}=${creds[f.key] ?? ""}`);
    }
    return lines.join("\n") + "\n";
  }

  function applyEnv() {
    if (!hasIndex) return;
    onApply({ ...files, ".env": buildEnv() });
  }

  function downloadEnv() {
    const blob = new Blob([buildEnv()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = ".env";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const setCred = (k: string, v: string) => setCreds((c) => ({ ...c, [k]: v }));

  const stepTitles = ["Chatbot", "QR", "Credenciales"];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">⚙️ Configurar landing</h3>
          <button className="text-slate-400 hover:text-white text-sm" onClick={onClose}>✕</button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-2 mb-5">
          {stepTitles.map((t, i) => (
            <div key={t} className="flex-1">
              <div className={`h-1 rounded-full ${i + 1 <= step ? "bg-indigo-500" : "bg-white/10"}`} />
              <p className={`text-xs mt-1 ${i + 1 === step ? "text-indigo-300" : "text-slate-500"}`}>{t}</p>
            </div>
          ))}
        </div>

        {!hasIndex && (
          <p className="text-sm text-amber-400 mb-4">
            Genera la landing primero (pestaña ✨ Prompts) para poder configurarla.
          </p>
        )}

        {/* STEP 1 — Chatbot */}
        {step === 1 && (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-white">
              <input type="checkbox" checked={wantBot} onChange={(e) => setWantBot(e.target.checked)} />
              Incluir un chatbot en la landing
            </label>
            <p className="text-xs text-slate-500">
              El chatbot atiende visitas, capta leads y <strong>puede agendar citas/reservas</strong> en Google Calendar.
            </p>

            {wantBot && (
              <div className="space-y-3 border-t border-white/5 pt-3">
                <div className="flex gap-4 text-sm text-slate-300">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="botmode" checked={botMode === "existing"} onChange={() => setBotMode("existing")} />
                    Usar uno existente
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="botmode" checked={botMode === "new"} onChange={() => setBotMode("new")} />
                    Crear uno nuevo
                  </label>
                </div>

                {botMode === "existing" && (
                  <>
                    {loadingAgents && <p className="text-xs text-slate-400">Cargando agentes...</p>}
                    {!loadingAgents && agents.length === 0 && (
                      <p className="text-xs text-slate-400">No tienes agentes. Crea uno nuevo.</p>
                    )}
                    {agents.length > 0 && (
                      <select
                        className="input-dark text-sm w-full"
                        value={selectedAgent}
                        onChange={(e) => setSelectedAgent(e.target.value)}
                      >
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    )}

                    {/* Guía de credenciales: reservas con Calendar */}
                    <div className="rounded-xl bg-black/30 border border-white/5 p-3 text-xs text-slate-400 space-y-1">
                      <p className="text-slate-300 font-medium">Para que el chatbot reserve en Google Calendar:</p>
                      <p>1. El admin debe tener configurado <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code> (Google Cloud Console → APIs → OAuth).</p>
                      <p>2. Conecta la cuenta de Google del negocio en el agente.</p>
                      {selectedAgentObj && !selectedHasGoogle && (
                        <p className="text-amber-400">
                          ⚠️ Este agente aún no tiene Google conectado.{" "}
                          <a href={`/agents/${selectedAgentObj.id}`} className="underline">Conectar ahora</a> (puedes hacerlo más tarde).
                        </p>
                      )}
                      {selectedAgentObj && selectedHasGoogle && (
                        <p className="text-emerald-400">✓ Google Calendar conectado.</p>
                      )}
                    </div>
                  </>
                )}

                {botMode === "new" && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400">
                      Te llevo al asistente de nuevo agente. Al terminar, volverás aquí y el chatbot se incluirá automáticamente.
                    </p>
                    <button className="btn-grad w-full text-xs py-2" onClick={goCreateAgent}>
                      ➕ Crear agente nuevo
                    </button>
                  </div>
                )}
              </div>
            )}

            {currentBot && (
              <p className="text-xs text-emerald-400">✓ Chatbot actual: {currentBot.name}</p>
            )}
          </div>
        )}

        {/* STEP 2 — QR */}
        {step === 2 && (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-white">
              <input type="checkbox" checked={wantQr} onChange={(e) => setWantQr(e.target.checked)} />
              Incluir código QR
            </label>
            <p className="text-xs text-slate-500">
              Genera un QR que apunta a una URL (tu landing, reservas, carta, precios...). Editable cuando quieras desde la pestaña 🔳 QR.
            </p>
            {wantQr && (
              <div className="space-y-3">
                <input
                  className="input-dark text-sm w-full"
                  placeholder="https://tu-landing.com/reservas"
                  value={qr}
                  onChange={(e) => setQr(e.target.value)}
                />
                {qrImg && (
                  <div className="flex flex-col items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrImg} alt="Código QR" className="w-40 h-40 rounded-xl bg-white p-2" />
                    <button className="btn-dark text-xs px-3 py-1.5" onClick={downloadQr}>
                      ⬇️ Descargar PNG
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 3 — Credenciales + .env */}
        {step === 3 && (
          <div className="space-y-4 text-sm">
            {/* Resumen compacto */}
            <ul className="text-xs text-slate-400 space-y-1">
              <li>Chatbot: {wantBot ? (selectedAgentObj?.name ?? "nuevo") : "no"}</li>
              <li>QR: {wantQr ? (qr.trim() || "(sin URL)") : "no"}</li>
              <li>Capa de datos: {dbProvider === "none" ? "ninguna" : dbProvider}</li>
            </ul>

            <div className="border-t border-white/5 pt-3 space-y-3">
              <div>
                <p className="text-white font-medium">Credenciales</p>
                <p className="text-xs text-slate-500">
                  Rellena y genero un archivo <code>.env</code> con todo lo necesario. Se añade al proyecto y puedes descargarlo.
                </p>
              </div>

              {/* Campos generales */}
              <div className="space-y-2">
                <label className="block text-xs text-slate-400">
                  URL del sitio
                  <input
                    className="input-dark text-sm w-full mt-1"
                    placeholder="https://tu-landing.com"
                    value={creds.SITE_URL ?? ""}
                    onChange={(e) => setCred("SITE_URL", e.target.value)}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Email de contacto
                  <input
                    className="input-dark text-sm w-full mt-1"
                    placeholder="hola@negocio.com"
                    value={creds.CONTACT_EMAIL ?? ""}
                    onChange={(e) => setCred("CONTACT_EMAIL", e.target.value)}
                  />
                </label>
              </div>

              {/* Campos según capa de datos */}
              {envFields.length > 0 && (
                <div className="space-y-2 border-t border-white/5 pt-3">
                  <p className="kicker">Datos · {dbProvider}</p>
                  {envFields.map((f) => (
                    <label key={f.key} className="block text-xs text-slate-400">
                      {f.label}
                      <input
                        className="input-dark text-sm w-full mt-1 font-mono"
                        placeholder={f.placeholder}
                        value={creds[f.key] ?? ""}
                        onChange={(e) => setCred(f.key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}

              {currentBotKey && (
                <p className="text-xs text-emerald-400">✓ Webbot key incluida en el .env</p>
              )}

              <div className="flex gap-2 pt-1">
                <button className="btn-grad flex-1 text-xs py-2" onClick={applyEnv} disabled={!hasIndex}>
                  💾 Generar .env en el proyecto
                </button>
                <button className="btn-dark text-xs px-3 py-2" onClick={downloadEnv}>
                  ⬇️ Descargar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer nav */}
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/5">
          <button
            className="btn-dark text-xs px-3 py-1.5"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
          >
            Atrás
          </button>
          <div className="flex gap-2">
            {step < 3 && (
              <button
                className="btn-grad text-xs px-4 py-1.5"
                onClick={() => {
                  if (step === 1) applyBot();
                  if (step === 2) applyQr();
                  setStep((s) => Math.min(3, s + 1));
                }}
              >
                Siguiente
              </button>
            )}
            {step === 3 && (
              <button className="btn-grad text-xs px-4 py-1.5" onClick={() => { applyEnv(); onClose(); }}>
                Finalizar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
