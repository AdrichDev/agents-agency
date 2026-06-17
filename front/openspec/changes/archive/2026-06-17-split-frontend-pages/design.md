# Design — Split Frontend Pages

## Decisión
Mover los componentes internos (SectionEditor, ProspectsTable, modales, formularios,
paneles) a ficheros bajo `front/components/` con sus props explícitas. Solo
reorganización: no se cambia JSX ni lógica. `renderMarkdown` ya está en `lib/markdown.ts`.
Verificación por build (no hay browser aquí); se preserva el markup tal cual.

## Rollback
Revertir el commit.
