"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Panel de credenciales LLM del cliente (H2 aa-credenciales-byok-multiproveedor, T6).
 *
 * Dos decisiones de esta pantalla que son de producto, no de estilo:
 *
 *  1. **El selector de modo avisa, no bloquea.** El orden natural es elegir "clave propia" y
 *     LUEGO pegarla; bloquear el primer paso obligaría a pegar la clave antes de poder elegir
 *     el modo al que sirve. El aviso queda visible mientras el modo esté sin respaldo, y el
 *     back corta de todos modos (402) si se intenta servir sin clave usable.
 *  2. **El campo de clave nunca se rellena con lo guardado**, porque no hay nada que rellenar:
 *     el back no la devuelve. Sólo se muestran los últimos 4 dígitos. Un campo con puntitos
 *     falsos daría a entender que se puede leer.
 */

type CredentialMode = "platform" | "byok";

interface Credential {
  provider: string;
  keyHint: string;
  status: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface LlmCredentialsPanelProps {
  tenantId: string;
  credentialMode: CredentialMode;
  onModeChange: (mode: CredentialMode) => void;
}

const PROVIDERS: { id: string; label: string; hint: string }[] = [
  { id: "openai", label: "OpenAI", hint: "sk-..." },
  { id: "gemini", label: "Google Gemini", hint: "AIza..." },
  { id: "anthropic", label: "Anthropic (Claude)", hint: "sk-ant-..." },
];

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  connected: { text: "Verificada", className: "text-emerald-400" },
  invalid: { text: "No válida", className: "text-red-400" },
  undecryptable: { text: "Ilegible", className: "text-amber-400" },
};

export function LlmCredentialsPanel({
  tenantId,
  credentialMode,
  onModeChange,
}: LlmCredentialsPanelProps) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setCredentials(await api<Credential[]>(`/api/clients/${tenantId}/llm-credentials`));
      setError("");
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar las credenciales.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byProvider = (id: string) => credentials.find((c) => c.provider === id) ?? null;
  const hasConnected = credentials.some((c) => c.status === "connected");

  async function changeMode(mode: CredentialMode) {
    setBusy("mode");
    setError("");
    try {
      await api(`/api/clients/${tenantId}/credential-mode`, {
        method: "PATCH",
        body: JSON.stringify({ credentialMode: mode }),
      });
      onModeChange(mode);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cambiar el modo.");
    } finally {
      setBusy(null);
    }
  }

  async function saveKey(provider: string) {
    const apiKey = (drafts[provider] ?? "").trim();
    if (!apiKey) return;
    setBusy(provider);
    setError("");
    try {
      await api(`/api/clients/${tenantId}/llm-credentials/${provider}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      });
      // Se limpia siempre: el campo es de escritura, no un reflejo de lo guardado.
      setDrafts((d) => ({ ...d, [provider]: "" }));
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar la clave.");
    } finally {
      setBusy(null);
    }
  }

  async function reverify(provider: string) {
    setBusy(provider);
    setError("");
    try {
      await api(`/api/clients/${tenantId}/llm-credentials/${provider}/verify`, { method: "POST" });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo verificar la clave.");
    } finally {
      setBusy(null);
    }
  }

  async function removeKey(provider: string) {
    setBusy(provider);
    setError("");
    try {
      await api(`/api/clients/${tenantId}/llm-credentials/${provider}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo retirar la clave.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="md:col-span-2 border-t border-edge pt-4 mt-1">
      <label className="block text-xs text-slate-400 mb-2">Facturación del consumo de IA</label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <ModeOption
          selected={credentialMode === "platform"}
          disabled={busy === "mode"}
          title="Incluido en la suscripción"
          description="La plataforma paga el modelo. El consumo descuenta del cupo de tokens."
          onSelect={() => changeMode("platform")}
        />
        <ModeOption
          selected={credentialMode === "byok"}
          disabled={busy === "mode"}
          title="Clave propia del cliente"
          description="El cliente paga su modelo directamente. El cupo de tokens no le aplica."
          onSelect={() => changeMode("byok")}
        />
      </div>

      {credentialMode === "byok" && !hasConnected && !loading && (
        <p className="text-[11px] text-amber-400 mt-2">
          Sin ninguna clave verificada el asistente no podrá responder. Añade la clave del
          proveedor del modelo que use el agente.
        </p>
      )}

      {credentialMode === "byok" && (
        <div className="mt-4 flex flex-col gap-3">
          {PROVIDERS.map((p) => {
            const cred = byProvider(p.id);
            const status = cred ? STATUS_LABEL[cred.status] : null;
            const isBusy = busy === p.id;

            return (
              <div key={p.id} className="rounded-xl border border-edge p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-slate-200">{p.label}</span>
                  {cred ? (
                    <span className={`text-[11px] ${status?.className ?? "text-slate-400"}`}>
                      {status?.text ?? cred.status} · ····{cred.keyHint}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">Sin configurar</span>
                  )}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="input-dark flex-1"
                    // Nunca se rellena con lo guardado: el back no devuelve la clave.
                    placeholder={cred ? `Pegar una clave nueva (${p.hint})` : p.hint}
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    disabled={isBusy}
                  />
                  <button
                    type="button"
                    onClick={() => saveKey(p.id)}
                    disabled={isBusy || !(drafts[p.id] ?? "").trim()}
                    className="btn-grad px-4 py-2 text-xs disabled:opacity-50"
                  >
                    {isBusy ? "..." : cred ? "Reemplazar" : "Guardar"}
                  </button>
                </div>

                {cred && (
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => reverify(p.id)}
                      disabled={isBusy}
                      className="text-[11px] text-slate-400 hover:text-white transition disabled:opacity-50"
                    >
                      Volver a verificar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeKey(p.id)}
                      disabled={isBusy}
                      className="text-[11px] text-red-400 hover:text-red-300 transition disabled:opacity-50"
                    >
                      Retirar
                    </button>
                  </div>
                )}

                {cred?.lastError && (
                  <p className="text-[11px] text-red-400 mt-2 break-words">{cred.lastError}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
    </div>
  );
}

function ModeOption({
  selected,
  disabled,
  title,
  description,
  onSelect,
}: {
  selected: boolean;
  disabled: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex-1 text-left rounded-xl border p-3 transition disabled:opacity-50 ${
        selected ? "border-indigo-500 bg-white/5" : "border-edge hover:bg-white/5"
      }`}
    >
      <span className="block text-xs font-bold text-slate-100">{title}</span>
      <span className="block text-[11px] text-slate-400 mt-0.5">{description}</span>
    </button>
  );
}
