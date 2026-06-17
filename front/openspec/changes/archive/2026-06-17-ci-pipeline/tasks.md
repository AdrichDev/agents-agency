# Tasks — CI Pipeline

## Fase 1 — Toolchain
- [x] 1.1 `.nvmrc` con la versión de Node (22)

## Fase 2 — Workflow
- [x] 2.1 `.github/workflows/ci.yml`: triggers push `master` + `pull_request`
- [x] 2.2 Job `back`: setup-node (.nvmrc, cache npm) → `npm ci` → `npm run typecheck` → `npm test` (cwd `back`)
- [x] 2.3 Job `front`: setup-node (.nvmrc, cache npm) → `npm ci` → `npm run typecheck` → `npm run build` (cwd `front`)

## Fase 3 — Verificación local
- [x] 3.1 Validar YAML del workflow (js-yaml parse OK)
- [x] 3.2 Reproducir comandos del CI en local: back `typecheck`+`test` (345) verdes; front `typecheck`+`build` verdes
