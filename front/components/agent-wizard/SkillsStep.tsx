import type { AgentWizardForm, Skill } from "@/components/agent-wizard/types";
import { capitalize } from "@/lib/text";

export default function SkillsStep({
  form,
  set,
  skills,
  categories,
  q,
  setQ,
  category,
  setCategory,
  page,
  setPage,
  totalPages,
}: {
  form: AgentWizardForm;
  set: <K extends keyof AgentWizardForm>(key: K, value: AgentWizardForm[K]) => void;
  skills: Skill[];
  categories: string[];
  q: string;
  setQ: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  page: number;
  setPage: (value: number) => void;
  totalPages: number;
}) {
  return (
    <div>
      <h2 className="font-semibold text-white mb-1">Paso 4 - Skills</h2>
      <p className="text-xs text-slate-500 mb-4">Selecciona skills cargadas en el marketplace.</p>
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
            setCategory("");
          }}
          className={!category ? "chip-accent" : "chip hover:text-slate-300"}
        >
          Todas
        </button>
        {categories.map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => {
              setPage(1);
              setCategory(item === category ? "" : item);
            }}
            className={category === item ? "chip-accent" : "chip hover:text-slate-300"}
          >
            {capitalize(item)}
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
              <span className="text-xs text-slate-600">({capitalize(skill.category)})</span>
              <br />
              <span className="text-slate-500">{skill.description.slice(0, 100)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-between items-center mt-3 text-xs text-slate-500">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="flex gap-2">
          <button type="button" className="chip" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <button type="button" className="chip" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
