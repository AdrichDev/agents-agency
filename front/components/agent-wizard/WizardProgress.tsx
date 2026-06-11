export default function WizardProgress({ steps, step }: { steps: string[]; step: number }) {
  return (
    <div className="flex gap-1.5 mb-8">
      {steps.map((label, i) => (
        <div key={label} className="flex-1 text-center">
          <div
            className={`h-1 rounded-full mb-2 ${
              i + 1 <= step ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500" : "bg-white/10"
            }`}
          />
          <span
            className={`text-[11px] uppercase tracking-wider ${
              i + 1 === step ? "text-indigo-300 font-semibold" : "text-slate-600"
            }`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

