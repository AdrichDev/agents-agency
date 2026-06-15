# Propuesta — Split Frontend Pages (>500 líneas)

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Calidad/mantenibilidad

## Intención

Extraer componentes internos de páginas grandes a ficheros propios, **preservando
el comportamiento y el render** (mover, no reescribir). Verificable por `next build`
+ `tsc`.

Páginas: `front/app/estadisticas/estudios/[id]/page.tsx` (920),
`front/app/contactos/page.tsx` (685), `front/app/estadisticas/page.tsx` (524).

## Criterios de éxito
- [x] Componentes internos movidos a `components/`; páginas <500 líneas.
- [x] `next build` + `tsc` verdes; sin cambios de comportamiento.
