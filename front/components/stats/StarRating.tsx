"use client";

interface StarRatingProps {
  value: number | null | undefined;
  max?: number;
  editable?: boolean;
  onChange?: (v: number) => void;
  size?: "sm" | "md";
}

export default function StarRating({
  value,
  max = 5,
  editable = false,
  onChange,
  size = "sm",
}: StarRatingProps) {
  const stars = Array.from({ length: max }, (_, i) => i + 1);
  const sizeCls = size === "sm" ? "text-sm" : "text-base";

  if (editable && onChange) {
    return (
      <span className={`inline-flex gap-0.5 ${sizeCls}`} aria-label={`Rating: ${value ?? "sin valorar"} de ${max}`}>
        {stars.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={`focus:outline-none transition-colors ${
              value && s <= value ? "text-yellow-400" : "text-slate-600 hover:text-yellow-300"
            }`}
            aria-label={`${s} estrella${s !== 1 ? "s" : ""}`}
          >
            {value && s <= value ? "★" : "☆"}
          </button>
        ))}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex gap-0.5 ${sizeCls}`}
      aria-label={`Rating: ${value ?? "sin valorar"} de ${max}`}
    >
      {stars.map((s) => (
        <span
          key={s}
          className={value && s <= value ? "text-yellow-400" : "text-slate-600"}
        >
          {value && s <= value ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}
