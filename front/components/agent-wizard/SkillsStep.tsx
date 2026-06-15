import type { AgentWizardForm, Skill } from "@/components/agent-wizard/types";
import { connectionBadgeLabel } from "@/lib/skill-capabilities";
import { Pagination } from "@/components/ui/Pagination";

export default function SkillsStep({
  form,
  set,
  skills,
  uses,
  q,
  setQ,
  use,
  setUse,
  page,
  setPage,
  totalPages,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
  skills: Skill[];
  uses: string[];
  q: string;
  setQ: (value: string) => void;
  use: string;
  setUse: (value: string) => void;
  page: number;
  setPage: (value: number) => void;
  totalPages: number;
}) {
  return (
    <div>
      <h2 className="font-semibold text-white mb-1">Paso 4 - Skills</h2>
      <p className="text-xs text-slate-500 mb-2">Selecciona skills cargadas en el marketplace.</p>
      <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl mb-4 text-xs text-slate-300 leading-relaxed">
        <strong>¿Para qué sirven las Skills?</strong> Permiten al agente ejecutar herramientas y realizar acciones externas (como conectarse a Slack, buscar repos de GitHub o analizar bases de datos científicas) para extender su funcionalidad más allá del simple chat.
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <input
          className="input-dark !w-52 !py-2"
          placeholder="Buscar por nombre..."
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <button
          type="button"
          onClick={() => {
            setPage(1);
            setUse("");
          }}
          className={!use ? "chip-accent" : "chip hover:text-slate-300"}
        >
          Todas
        </button>
        {uses.map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => {
              setPage(1);
              setUse(item === use ? "" : item);
            }}
            className={use === item ? "chip-accent" : "chip hover:text-slate-300"}
          >
            {item.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
        {skills.map((skill) => (
          <label
            key={skill.id}
            className="flex items-start gap-3 text-sm card !rounded-xl p-3 cursor-pointer hover:bg-white/10 hover:border-indigo-500/40"
          >
            <input
              type="checkbox"
              className="mt-1 accent-indigo-500"
              checked={form.skillIds.includes(skill.id)}
              onChange={(e) =>
                set(
                  "skillIds",
                  e.target.checked
                    ? [...form.skillIds, skill.id]
                    : form.skillIds.filter((id) => id !== skill.id)
                )
              }
            />
            <span>
              <strong className="text-slate-200">{skill.name}</strong>{" "}
              <span className="text-xs text-slate-600">
                ({(skill.type || "SKILL").toUpperCase()} · {(skill.use || "GENERAL").toUpperCase()})
              </span>
              {connectionBadgeLabel(skill) && (
                <span className="ml-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-1.5 py-0.5">
                  {connectionBadgeLabel(skill)}
                </span>
              )}
              <br />
              <span className="text-slate-500">{skill.description.slice(0, 100)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
