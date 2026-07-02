# Tasks — aa-bug-appearance-keys-duplicadas

## Fase A — Fix
- [ ] A.1 `front/components/configuracion/AppearanceSection.tsx:93`: cambiar `key={p.value}` por `key={p.name}` (confirmar unicidad de `name` en todo `SECONDARY_PRESETS` antes).
- [ ] A.2 Decidir y aplicar si se elimina el duplicado real (`Fucsia` / `Neon Pink`, mismo hex `#d946ef`) según respuesta a la open question.
- [ ] A.3 (Opcional, recomendado) activar `react/jsx-key` como error en la config de ESLint del proyecto.

## Fase B — Verificación
- [ ] B.1 `npm run typecheck` limpio.
- [ ] B.2 `npm run test:e2e` verde (incluye test nuevo de consola sin warning).
- [ ] B.3 Verificación manual: abrir Appearance, consola del navegador limpia.

## Tras verde: gate Ruflo (revisión refactor) ANTES de cualquier commit/push.
- [ ] Ruflo PASS.
