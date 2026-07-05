# Tasks — aa-front-react-19  (Nivel 3 — APROBADO)

> F4 (última) del plan de versiones. Validación = typecheck + next build.

## Fase A — Upgrade
- [x] A.1 react/react-dom → ^19.2.7, @types/react/@types/react-dom → ^19.2.17. `npm install` (ERESOLVE warnings peer = no fatal).

## Fase B — Verificación
- [x] B.1 `npm run typecheck` limpio tras 1 fix: `components/agents/KnowledgeTab.tsx` `fileInputRef: RefObject<HTMLInputElement | null>` (React 19 `useRef` devuelve `RefObject<T | null>`).
- [x] B.2 `npm run build` (next build) OK — todas las rutas compilan con React 19.

## Tras verde: gate Agentic Runtime ANTES de cualquier commit/push.
- [x] Agentic Runtime PASS — diff mínimo (1 type fix); gate = typecheck + next build verde.
