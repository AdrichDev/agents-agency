# Tasks — aa-bug-appearance-keys-duplicadas

## Fase A — Fix
- [ ] A.1 `front/components/configuracion/AppearanceSection.tsx:93`: cambiar `key={p.value}` por `key={p.name}` (confirmar unicidad de `name` en todo `SECONDARY_PRESETS` antes).
- [ ] A.2 Decidir y aplicar si se elimina el duplicado real (`Fucsia` / `Neon Pink`, mismo hex `#d946ef`) según respuesta a la open question.
- [ ] A.3 (Opcional, recomendado) activar `react/jsx-key` como error en la config de ESLint del proyecto.

## Fase B — Verificación
- [ ] B.1 `npm run typecheck` limpio.
- [ ] B.2 `npm run test:e2e` verde (incluye test nuevo de consola sin warning).
- [ ] B.3 Verificación manual: abrir Appearance, consola del navegador limpia.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [ ] Agentic Runtime PASS.

## Cierre — 28/07/2026

Cierre por OBSOLETO: el defecto ya no se reproduce. En `front/components/configuracion/AppearanceSection.tsx:16` el preset "Neon Pink" vale `#ff2e9a` y ya no colisiona con el `#d946ef` de Fucsia; `SECONDARY_PRESETS` no contiene valores duplicados. La colisión de claves de React que motivaba este cambio desapareció al cambiar la paleta.

**Casillas sin marcar**: se dejan tal cual a propósito. Describen un arreglo que el código alcanzó por otra vía; marcarlas afirmaría un trabajo que nadie hizo.
