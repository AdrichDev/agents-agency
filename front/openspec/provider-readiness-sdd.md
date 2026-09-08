# SDD: Provider Readiness

## Contexto

Estado actual reportado:

| Provider | Estado |
| --- | --- |
| ecc | READY |
| awesomeCopilot | CATALOGO AUSENTE |
| deepagents | ADAPTER MISSING |
| gentlePi | MISSING |
| gentlemanCli | MISSING |
| engram | MISSING |
| local | MISSING, opcional |

Regla de runtime:

- Gru no simula providers.
- Cada provider debe pasar `checkAvailability()` antes de ejecutarse.
- Si falta runtime real, bloquea con `installHint`.
- `awesomeCopilot` es catalogo local de skills, no CLI.
- `deepagents` necesita adapter ejecutable compatible con `node adapter.mjs run "prompt"`.

## Nivel

TASK_LEVEL: 3
RISK_LEVEL: 2

Motivos:

- Toca 2 dominios: catalogo de skills y adapter SDK.
- Puede requerir red para clonar catalogo.
- Puede requerir dependencias externas para DeepAgents.
- Cambios reversibles si se hacen en rama/local.

Gates humanos obligatorios:

- Clonar repos externos.
- Instalar paquetes.
- Definir variables de entorno persistentes.
- Habilitar provider nuevo en entorno compartido.

## Objetivo

Llevar `awesomeCopilot` y `deepagents` de estado ausente a estado usable, sin degradar `ecc`.

No objetivo:

- Instalar `gentlePi`, `gentlemanCli`, `engram` o runtime `local`.
- Hacer push, commit o despliegue.
- Simular disponibilidad.

## Spec

### S1: Awesome Copilot Catalog

Como Gru, quiero detectar un catalogo local de `awesome-copilot` para buscar skills reales en archivos `SKILL.md`.

Aceptacion:

- `awesomeCopilot.checkAvailability()` devuelve `available: true` si existe `<root>/skills`.
- `<root>` viene de `GRU_AWESOME_COPILOT_PATH` o `vendor/awesome-copilot`.
- Si no existe, devuelve `available: false`, `status: missing`, `kind: catalog` y hint accionable.
- `run()` busca `SKILL.md` bajo `<root>/skills` y devuelve matches reales.
- No descarga nada durante `checkAvailability()` ni durante `run()`.

### S2: DeepAgents Adapter

Como Gru, quiero ejecutar DeepAgents mediante un adapter explicito para no confundir libreria con CLI.

Aceptacion:

- `deepagents.checkAvailability()` devuelve `available: true` solo si `GRU_DEEPAGENTS_ENTRY` apunta a archivo existente.
- El adapter acepta `node <entry> run "<prompt>"`.
- `deepagents.run()` ejecuta ese adapter y propaga `exitCode`, `stdout`, `stderr` y error real.
- Si falta entrypoint, estado `missing`, `kind: sdk`, hint accionable.
- No hay fallback silencioso.

### S3: Status CLI

Como usuario, quiero que `pnpm gru status` muestre estados claros.

Aceptacion:

- `ecc` sigue READY.
- `awesomeCopilot` muestra READY solo cuando existe catalogo.
- `deepagents` muestra READY solo cuando existe adapter.
- Missing no rompe la tabla; sale con codigo 2 si hay providers requeridos no disponibles.
- Los hints no recomiendan `npx` para providers que requieren `pnpm`.

## Design

### Archivos esperados

| Archivo | Cambio |
| --- | --- |
| `.gru/providers.yaml` | Mantener comandos y hints coherentes con health checks. |
| `packages/providers/awesome-copilot/src/index.ts` | Asegurar `status`, `kind`, path configurable, mensajes claros. |
| `packages/providers/deepagents/src/index.ts` | Asegurar `status`, `kind`, adapter contract y errores claros. |
| `apps/cli/src/index.ts` | Mostrar estado/kind si hace falta para diagnostico. |
| `STRICT_PROVIDER_RUNTIME.md` | Documentar comandos finales si cambia contrato. |

### Adapter DeepAgents

Ruta sugerida:

```text
adapters/deepagents/entry.mjs
```

Contrato:

```text
node adapters/deepagents/entry.mjs run "prompt"
```

Salida:

- `stdout`: resultado del provider.
- `stderr`: diagnostico real.
- exit code `0`: exito.
- exit code no cero: fallo real.

### Catalogo Awesome Copilot

Opcion A:

```powershell
git clone https://github.com/github/awesome-copilot vendor/awesome-copilot
```

Opcion B:

```powershell
$env:GRU_AWESOME_COPILOT_PATH="D:\ruta\awesome-copilot"
```

## Tasks

### Fase 1: Baseline

- Ejecutar `pnpm.cmd gru status`.
- Guardar estado actual en notas de tarea, no en Engram.
- Confirmar `ecc` READY.

### Fase 2: Awesome Copilot

- Pedir aprobacion humana para clonar o usar path local.
- Si hay path local, definir `GRU_AWESOME_COPILOT_PATH` solo para la sesion.
- Si se aprueba clone, crear `vendor/awesome-copilot`.
- Ejecutar `pnpm.cmd gru status`.
- Ejecutar prompt de prueba que enrute a `awesomeCopilot`.

Prompt prueba:

```text
busca skills de seguridad en el catalogo awesome copilot
```

### Fase 3: DeepAgents

- Pedir aprobacion humana para instalar dependencias si no existen.
- Crear adapter minimo solo si existe SDK real disponible.
- Definir `GRU_DEEPAGENTS_ENTRY` solo para la sesion.
- Ejecutar `pnpm.cmd gru status`.
- Ejecutar prompt de prueba que enrute a `deepagents`.

Prompt prueba:

```text
ejecuta workflow persistente con checkpoint para esta tarea
```

### Fase 4: CLI Polish

- Si `status` no muestra `status/kind`, ajustar tabla.
- Mantener salida compacta.
- No ocultar providers faltantes.

### Fase 5: Verify

- `pnpm.cmd exec tsc --noEmit`
- `pnpm.cmd gru status`
- Prueba `awesomeCopilot.run()`
- Prueba `deepagents.run()`

## Devil Check

Riesgos:

- Clonar catalogo grande puede meter ruido en repo.
- Adapter DeepAgents falso viola policy.
- Variables de entorno persistentes pueden crear estado invisible.
- `pnpm dlx` puede depender de red y fallar en CI.

Mitigacion:

- No clonar sin aprobacion.
- Adapter solo si SDK real existe.
- Env vars por sesion hasta que humano apruebe persistencia.
- Hints deben explicar instalacion y verificacion manual.

## Decision Recomendada

Primero `awesomeCopilot`.

Razon:

- Menor riesgo.
- Sin codigo si el usuario acepta clone o path local.
- Valida rapido el patron de provider catalog.

Despues `deepagents`.

Razon:

- Requiere adapter y posiblemente dependencia externa.
- Mayor riesgo de inventar runtime si no hay SDK real instalado.
