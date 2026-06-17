# Propuesta — CI Pipeline

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 3 (control de versiones / estabilidad)

## Intención

Pilar 3: garantizar la estabilidad del software y evitar romper la app al lanzar
actualizaciones. Hoy el repo tiene git pero **ninguna verificación automática**:
un push puede introducir un fallo de tipos, un test roto o un build que no
compila sin que nadie lo note hasta runtime.

Se añade un pipeline de **Integración Continua** (GitHub Actions) que, en cada
push a `master` y en cada Pull Request, ejecuta las mismas comprobaciones que ya
usamos en local:

- **Backend**: `tsc --noEmit` + `vitest` (los tests mockean Prisma → no requieren
  BD).
- **Frontend**: `tsc --noEmit` + `next build`.

Si cualquiera falla, el check de GitHub queda en rojo y bloquea el merge.
Además se fija la versión de Node del toolchain con `.nvmrc` para reproducibilidad.

**Éxito**: ningún cambio con tipos rotos, tests fallando o build roto entra en
`master` sin que CI lo marque.

## Fuera de alcance (diferido)

| Tema | Motivo |
|------|--------|
| E2E Playwright en CI | Necesita servers + BD levantados; se añadirá cuando haya entorno de servicios en CI |
| Deploy automático (CD) | No se va a producción todavía (local) |
| Branch protection rules | Se configura en GitHub (UI), fuera del repo |

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `.github/workflows/ci.yml` | Nuevo | Workflow con jobs back y front |
| `.nvmrc` | Nuevo | Versión de Node fijada (22) |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| `npm ci` falla si el lockfile no está sincronizado | Media | Lockfiles ya presentes (back/front); CI usa `npm ci` |
| `postinstall` (prisma generate) falla sin BD | Baja | `prisma generate` no necesita BD, solo el schema |
| Tests requieren BD en CI | Baja | Los 345 tests mockean Prisma; verificado corriendo sin BD |

## Criterios de éxito

- [x] Workflow se dispara en push a `master` y en Pull Requests.
- [x] Job back: `npm ci` → `npm run typecheck` → `npm test` verde.
- [x] Job front: `npm ci` → `npm run typecheck` → `npm run build` verde.
- [x] `.nvmrc` fija la versión de Node usada por CI y dev.
- [x] YAML válido; comandos verificados en local antes de subir.
