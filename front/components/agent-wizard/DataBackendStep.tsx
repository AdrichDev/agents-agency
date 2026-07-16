import type { AgentWizardForm, BackendCapability } from "@/components/agent-wizard/types";

/**
 * Paso "Datos del negocio" (F4 aa-agent-backend-foundation, design.md §B.5).
 * Sustituye al paso Skills. Selección OBLIGATORIA, sin default silencioso:
 *  - managed_db: el agente opera datos (aprovisionamos BD gestionada) y
 *    requiere elegir al menos una capacidad (reservas / leads / pedidos).
 *  - none_yet: salida rápida "solo información / FAQ", elección explícita.
 * external_api (URL + key del cliente) = backlog v2, no se ofrece aquí.
 */

const CAPABILITIES: { id: BackendCapability; title: string; desc: string }[] = [
  { id: "reservas", title: "Reservas", desc: "Consultar disponibilidad y crear citas reales." },
  { id: "leads", title: "Leads", desc: "Guardar contactos interesados que deja la conversación." },
  { id: "pedidos", title: "Pedidos", desc: "Consultar el estado de un pedido por su código." },
];

export default function DataBackendStep({
  form,
  set,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
}) {
  function toggleCapability(id: BackendCapability, checked: boolean) {
    set(
      "dataBackendCapabilities",
      checked
        ? [...form.dataBackendCapabilities, id]
        : form.dataBackendCapabilities.filter((c) => c !== id)
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-white mb-1">Datos del negocio</h2>
        <p className="text-xs text-slate-500">
          ¿Dónde vive la data que el agente opera? Elige una opción para continuar — no hay valor
          por defecto.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Datos del negocio">
        <label
          className={`rounded-xl p-4 text-left border transition cursor-pointer ${
            form.dataBackendMode === "managed_db"
              ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15"
              : "border-edge hover:border-[var(--neon-purple)]/50 hover:bg-white/5"
          }`}
        >
          <input
            type="radio"
            name="dataBackendMode"
            className="sr-only"
            checked={form.dataBackendMode === "managed_db"}
            onChange={() => set("dataBackendMode", "managed_db")}
            aria-label="El agente gestiona datos"
          />
          <div className="font-medium text-sm text-slate-200">El agente gestiona datos</div>
          <div className="text-xs text-slate-500 mt-1">
            Aprovisionamos una base de datos gestionada para el negocio y el agente opera contra
            ella (reservas, leads, pedidos). Elige abajo qué capacidades necesita.
          </div>
        </label>

        <label
          className={`rounded-xl p-4 text-left border transition cursor-pointer ${
            form.dataBackendMode === "none_yet"
              ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15"
              : "border-edge hover:border-[var(--neon-purple)]/50 hover:bg-white/5"
          }`}
        >
          <input
            type="radio"
            name="dataBackendMode"
            className="sr-only"
            checked={form.dataBackendMode === "none_yet"}
            onChange={() => {
              set("dataBackendMode", "none_yet");
              set("dataBackendCapabilities", []);
            }}
            aria-label="Solo información"
          />
          <div className="font-medium text-sm text-slate-200">Solo información (FAQ)</div>
          <div className="text-xs text-slate-500 mt-1">
            El agente responde con su personalidad y base de conocimiento, sin operar datos del
            negocio. Podrás activar un backend de datos más adelante.
          </div>
        </label>
      </div>

      {form.dataBackendMode === "managed_db" && (
        <div>
          <p className="text-xs text-slate-400 mb-2">
            Capacidades del agente <span className="text-slate-600">(elige al menos una)</span>
          </p>
          <div className="grid grid-cols-3 gap-3">
            {CAPABILITIES.map((cap) => (
              <label
                key={cap.id}
                className={`rounded-xl p-3 text-left border transition cursor-pointer ${
                  form.dataBackendCapabilities.includes(cap.id)
                    ? "border-[var(--neon-purple)] bg-[var(--neon-purple)]/15"
                    : "border-edge hover:border-[var(--neon-purple)]/50 hover:bg-white/5"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={form.dataBackendCapabilities.includes(cap.id)}
                  onChange={(e) => toggleCapability(cap.id, e.target.checked)}
                  aria-label={cap.title}
                />
                <div className="font-medium text-sm text-slate-200">{cap.title}</div>
                <div className="text-xs text-slate-500 mt-1">{cap.desc}</div>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500 rounded-xl border border-edge bg-white/5 p-3 mt-3">
            🗄️ La base de datos se aprovisiona con el esquema estándar del sector «
            {form.sector || "—"}». Quedará <span className="text-slate-300">pendiente de
            configurar</span> hasta completar el alta en la ficha del agente.
          </p>
        </div>
      )}
    </div>
  );
}
