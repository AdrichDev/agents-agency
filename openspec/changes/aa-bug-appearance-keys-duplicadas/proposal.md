# Proposal — Fix keys duplicadas en presets de color (aa-bug-appearance-keys-duplicadas)

**Nivel Gru: 1 — Pequeño.** Un solo archivo, cambio local y reversible.

## Contexto
`front/components/configuracion/AppearanceSection.tsx:14-23` define el array `SECONDARY_PRESETS` con dos entradas de mismo `value`: `{name:"Fucsia",value:"#d946ef"}` (línea 15) y `{name:"Neon Pink",value:"#d946ef"}` (línea 16). El `.map()` que renderiza las `<option>` usa `key={p.value}` (línea 93), así que React emite el warning "two children with same key '#d946ef'" y puede renderizar mal la lista si cambia.

## Intención
Eliminar el warning de React y asegurar que cada `<option>` tenga una key única y estable.

## Alcance
- `front/components/configuracion/AppearanceSection.tsx:93`: cambiar `key={p.value}` por `key={p.name}` (o índice, si `name` no garantiza unicidad — verificar el array completo primero).
- Evaluar si además conviene eliminar el duplicado real (`"Fucsia"` vs `"Neon Pink"` con el mismo hex) o dejarlo como dos presets con nombres distintos pero mismo color (decisión de producto menor).
- Recomendar activar la regla ESLint `react/jsx-key` como error para prevenir regresiones futuras.

## Fuera de alcance
- Rediseño de la paleta de colores de Appearance.

## Open questions
- ¿Se elimina uno de los dos presets duplicados (`Fucsia`/`Neon Pink`) o se dejan ambos con nombres distintos apuntando al mismo hex? Confirmar con quien mantiene el diseño de la sección Apariencia.

## Riesgos
- Ninguno relevante. Cambio local, reversible, sin impacto en datos ni sesión.
