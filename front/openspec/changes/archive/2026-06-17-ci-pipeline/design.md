# Design — CI Pipeline

## Decisiones de arquitectura

### ADR-1 — GitHub Actions (vs otros CI)
El remoto ya está en GitHub (`AdrichDev/agents-agency`). Actions es nativo, sin
infraestructura extra ni cuentas adicionales. Workflow declarativo en
`.github/workflows/ci.yml`.

### ADR-2 — Dos jobs paralelos: back y front
Back y front tienen toolchains y comandos distintos (vitest vs next build) y
lockfiles separados (monorepo sin workspaces). Dos jobs independientes corren en
paralelo, fallan de forma aislada y dan feedback más claro. Cada uno cachea sus
dependencias por su `package-lock.json`.

### ADR-3 — Sin BD en CI (de momento)
Los 345 tests de backend mockean Prisma (`vi.mock("@/lib/db")`), verificado
corriendo `vitest` sin PostgreSQL levantado. Por eso el job back NO declara un
servicio de base de datos: más rápido y simple. Cuando se añadan tests de
integración reales, se incorporará un `services: postgres` al job.

### ADR-4 — Front: typecheck + build, sin E2E todavía
`next build` cubre la compilación y el chequeo de producción. Playwright (E2E)
necesita servers (front+back) y BD arriba; se difiere hasta tener un entorno de
servicios en CI. `quality.typecheck` y `verify.build_command` de `config.yaml` se
respetan; `e2e_command` queda pendiente.

### ADR-5 — Node 22 LTS vía `.nvmrc` + `actions/setup-node`
Se fija Node 22 (LTS) para reproducibilidad. `setup-node` lee `.nvmrc`
(`node-version-file`) y habilita caché de npm por lockfile. Compatible con
Next 14 y Prisma 7.

## Estructura del workflow

```
on: [push: master, pull_request]
jobs:
  back:
    - checkout
    - setup-node (node-version-file: .nvmrc, cache: npm, cache-dependency-path: back/package-lock.json)
    - npm ci            (cwd back)   # postinstall → prisma generate (sin BD)
    - npm run typecheck (cwd back)
    - npm test          (cwd back)   # vitest, prisma mockeado
  front:
    - checkout
    - setup-node (cache-dependency-path: front/package-lock.json)
    - npm ci            (cwd front)
    - npm run typecheck (cwd front)
    - npm run build     (cwd front)  # next build
```

## Plan de rollback
Cambio aditivo (solo ficheros nuevos: workflow + `.nvmrc`). Rollback = borrar el
workflow. No afecta código de producto, datos ni runtime de la app.
