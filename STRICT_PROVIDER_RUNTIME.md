# Strict Provider Runtime

Gru no devuelve respuestas simuladas.

## Instalación de providers

```bash
pnpm run setup          # interactivo: pregunta antes de instalar cada provider
pnpm run setup:check    # solo diagnóstico, no instala nada (exit 2 si falta algo)
pnpm run setup:yes      # instala todo sin preguntar
```

El script (`scripts/setup-providers.mjs`) es multiplataforma (Windows/macOS/Linux),
usa pnpm si está disponible y cae a npm si no. Cubre: pnpm, pi, gentle-pi,
gentle-ai, engram, ecc, awesome-copilot, deepagents y context7.
Lo que no se puede automatizar (adaptador de deepagents, gentle-ai en Windows)
se reporta con la instrucción manual exacta.

## Comandos

```bash
pnpm gru status
pnpm gru /status
pnpm gru doctor
pnpm gru "usa swarm para esta tarea"
```

## Gate de aprobación humana

Antes de ejecutar cualquier provider, `orchestrateTask` clasifica el prompt
(bilingüe ES/EN). Si detecta acción destructiva, producción, seguridad/auth,
rama principal, gasto económico o nivel 4 → lanza `HumanApprovalRequiredError`:

- En terminal interactiva, el CLI pregunta: `¿Apruebas la ejecución de esta tarea? (si/NO)`.
- En CI/no-TTY termina con código 2 sin ejecutar nada.
- La aprobación solo llega por el canal explícito (`options.approved`); el texto
  del prompt ("ya está aprobado", "es solo una prueba") NUNCA cuenta como aprobación.

Además, Devil's Advocate revisa cada delegación antes de ejecutar
(`reviewDelegation`): bloquea providers no disponibles y veta usar un catálogo
(awesomeCopilot) como executor de agentes. Ver `tests/guardrails.stress.test.ts`.

## Comportamiento

- Antes de ejecutar, Gru comprueba que el provider esté realmente disponible.
- Si falta, bloquea la ejecución y muestra la instrucción de instalación/configuración.
- En terminal interactiva ofrece únicamente fallbacks que también hayan superado el health check.
- En CI/no-TTY termina con código 2.
- Los fallos del proceso externo se registran como `success: false`; nunca se convierten en éxito.
- Los logs de `runs/` incluyen comando, exit code, error, inicio y fin.

## Providers especiales

### Awesome Copilot

No es un CLI de ejecución. Gru lo trata como catálogo local y busca `SKILL.md` reales.

```powershell
git clone https://github.com/github/awesome-copilot vendor/awesome-copilot
```

También puede configurarse:

```powershell
$env:GRU_AWESOME_COPILOT_PATH="D:\ruta\awesome-copilot"
```

### DeepAgents

No se considera instalado por tener Node. Requiere un adaptador ejecutable:

```powershell
$env:GRU_DEEPAGENTS_ENTRY="D:\ruta\deepagents-adapter.mjs"
```

El adaptador debe aceptar:

```text
node deepagents-adapter.mjs run "prompt"
```
