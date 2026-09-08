# SDD: Harness Runtime Abstraction

## Contexto

Gru-Orchestrator actualmente hardcodea el modelo y el proveedor en los providers.
DeepAgents abre una conexión SDK secundaria aunque Gru ya esté dentro de un harness
(Claude, Codex, Gemini, Pi) que gestiona el modelo por su cuenta.

Parche de contención aplicado (ver providers/deepagents):
- `host-managed` detectado pero devuelve `adapter-missing`, no READY.
- `sdk-managed` requiere `GRU_DEEPAGENTS_PROVIDER` + `GRU_DEEPAGENTS_API_KEY_ENV`.
- Modelo no está hardcodeado.

Esta SDD cubre la implementación completa.

## Nivel

TASK_LEVEL: 4
RISK_LEVEL: 3

Motivos:
- Afecta kernel, shared, providers, CLI, configuración y sync de harnesses.
- Cambios en contratos públicos.
- Requiere adapters por harness con comportamientos distintos.
- Puede romper providers existentes si no se migra bien.

Gates humanos obligatorios:
- Aprobar el contrato `HarnessAdapter` antes de implementar adapters. ✓ APROBADO
- Aprobar el formato de salida de `pnpm gru sync` antes de generarlo.
- Revisar cada adapter antes de activarlo.

## Separación de responsabilidades (decisión de diseño)

`HarnessAdapter` cubre solo ejecución via harness. No absorbe otras capas:

| Contrato | Responsabilidad | Ejemplos |
|---|---|---|
| `HarnessAdapter` | Ejecutar via Claude/Codex/Gemini/Pi | ClaudeAdapter, CodexAdapter |
| `ExecutionProvider` | Providers de orquestación SDK | DeepAgents |
| `ContextSource` | Recuperación documental | Context7, web, repo |
| `MemoryProvider` | Memoria persistente | Engram |
| `CapabilityCatalog` | Catálogos de skills/hooks | Awesome Copilot, ECC |
| `Persona` | Transformación de output | Caveman, DevilsAdvocate |

Cada contrato se define en su propia fase. No mezclar.

## Objetivo

Gru Core no debe conocer el modelo ni el proveedor.
El harness activo gestiona la ejecución.
Cada harness tiene un adapter con capacidades declaradas.
`pnpm gru sync` genera `.claude/`, `.codex/`, `.gemini/` desde fuente canónica.

No objetivo:
- Cambiar comportamiento de ecc, awesomeCopilot o engram.
- Implementar todos los adapters a la vez.
- Hacer push o despliegue.

## Spec

### S1: HarnessAdapter Contract

```typescript
export interface HarnessAdapter {
  id: HarnessId;
  execute(task: GruTask): Promise<GruResult>;
  supports(capability: GruCapability): boolean;
  getContext(): Promise<HarnessContext>;
  requestApproval?(request: ApprovalRequest): Promise<boolean>;
}

export type GruCapability =
  | "native-subagents"
  | "file-tools"
  | "web-search"
  | "code-execution"
  | "memory"
  | "approval-flow";

export interface HarnessContext {
  harness: HarnessId;
  model?: string;
  capabilities: GruCapability[];
}
```

Aceptacion:
- Todo adapter implementa `HarnessAdapter`.
- `supports()` devuelve capacidades reales, no supuestas.
- `execute()` no abre conexión SDK secundaria si el harness ya gestiona el modelo.

### S2: HarnessDetector

Aceptacion:
- `detectHarness()` detecta el harness activo o devuelve `standalone`.
- La detección es por variables de entorno conocidas, no por heurísticas de filesystem.
- Si hay ambigüedad, devuelve `standalone` (fail-safe).
- Tabla de variables documentada en código.

### S3: ClaudeAdapter

Aceptacion:
- `id: "claude"`.
- `execute()` usa las herramientas nativas de Claude Code (Agent, file tools).
- `supports("native-subagents")` → true.
- No llama a Anthropic API directamente.

### S4: CodexAdapter

Aceptacion:
- `id: "codex"`.
- `execute()` usa sandbox y subagentes de Codex.
- `supports("code-execution")` → true.

### S5: StandaloneAdapter

Aceptacion:
- `id: "standalone"`.
- `execute()` usa SDK configurado (provider + model + apiKey).
- `supports()` refleja capacidades del SDK usado.
- Bloquea si no hay proveedor configurado.

### S6: DeepAgents host-managed

Aceptacion:
- `DeepagentsProvider.run()` delega al `HarnessAdapter` activo.
- No instancia `createDeepAgent` cuando `mode: host-managed`.
- Devuelve `available: true` solo cuando el adapter está implementado.

### S7: CapabilityMatrix

Aceptacion:
- Tabla estática de capacidades por harness.
- `if (adapter.supports("native-subagents")) { delegate } else { fallback }`.
- Ningún adapter finge tener una capacidad que no implementa.

### S8: pnpm gru sync

Aceptacion:
- Lee `gru/skills/`, `gru/workflows/`, `gru/policies/`.
- Genera `.claude/`, `.codex/`, `.gemini/`, `.pi/` adaptando formato por harness.
- Idempotente.
- No sobreescribe archivos editados manualmente sin `--force`.
- Muestra diff antes de escribir.

## Design

### Estructura de directorios

```
Gru-Orchestrator/
├── gru/
│   ├── core/          # lógica de clasificación y workflow de Gru
│   ├── contracts/     # HarnessAdapter, GruTask, GruResult
│   ├── skills/        # fuente canónica de skills
│   ├── workflows/     # fuente canónica de workflows
│   └── policies/      # guardrails, human-in-the-loop, escalación
├── adapters/
│   ├── claude/        # ClaudeAdapter
│   ├── codex/         # CodexAdapter
│   ├── gemini/        # GeminiAdapter (stub hasta implementar)
│   ├── pi/            # PiAdapter (stub hasta implementar)
│   └── standalone/    # StandaloneAdapter (SDK directo)
├── packages/
│   ├── shared/
│   │   ├── src/ports/provider.ts
│   │   └── src/runtime/harness.ts  ← ya existe
│   ├── kernel/
│   └── providers/
└── openspec/
```

### Flujo de ejecución

```
pnpm gru "prompt"
        ↓
HarnessDetector.detect()
        ↓
AdapterRegistry.get(harnessId)
        ↓
adapter.supports(requiredCapability)?
   ├── sí → adapter.execute(task)
   └── no → gruFallback.executeSequentially(task)
        ↓
GruResult → CLI output
```

### Routing de modelo

```
Codex UI → GPT-5.5     → CodexAdapter.execute()
Claude CLI → Sonnet    → ClaudeAdapter.execute()
Gemini UI → Gemini     → GeminiAdapter.execute()
pnpm gru (standalone)  → StandaloneAdapter.execute() + SDK configurado
```

Gru Core no llama a ningún modelo. El adapter es responsable.

### DeepAgents en host-managed

```
Gru → DeepagentsProvider.run()
           ↓
     HarnessAdapter.execute(task)
           ↓
     harness ejecuta con su modelo nativo
```

No se instancia `createDeepAgent`. No se abre conexión SDK.

### DeepAgents en sdk-managed

```
Gru → DeepagentsProvider.run()
           ↓
     createDeepAgent({ model: GRU_DEEPAGENTS_MODEL })
           ↓
     SDK llama a proveedor configurado
```

Solo válido en standalone.

## Tasks

### Fase 1: Contratos

- Definir `HarnessAdapter`, `GruTask`, `GruResult`, `GruCapability` en `packages/shared/src/ports/`.
- Definir `AdapterRegistry` en `packages/kernel/`.
- Aprobación humana del contrato antes de fase 2.

### Fase 2: StandaloneAdapter

- Implementar `adapters/standalone/`.
- Migrar lógica sdk-managed de `DeepagentsProvider` al adapter.
- Tests: standalone con proveedor mock.

### Fase 3: ClaudeAdapter

- Implementar `adapters/claude/`.
- `execute()` usa Agent tool de Claude Code.
- `supports()` declara capacidades reales.
- Tests: verificar que no abre conexión secundaria.

### Fase 4: DeepAgents host-managed funcional

- `DeepagentsProvider.run()` llama a `AdapterRegistry.get().execute()`.
- Devuelve `available: true` cuando adapter existe.
- Tests: verificar delegación correcta.

### Fase 5: CodexAdapter y GeminiAdapter (stubs)

- Implementar stubs que devuelvan `supports() = false` para todo.
- Activan fallback a ejecución secuencial.

### Fase 6: pnpm gru sync

- Definir estructura `gru/skills/` y `gru/workflows/`.
- Implementar generador por harness.
- Verificar idempotencia.
- Aprobación humana del formato generado.

### Fase 7: Migración assets canónicos

- Mover skills y workflows de `.claude/` a `gru/`.
- Regenerar `.claude/`, `.codex/`, `.gemini/` con `pnpm gru sync`.
- Verificar que `.claude/` sigue funcionando igual.

## Devil Check

Riesgos:
- ClaudeAdapter que finge usar el harness pero llama al SDK igualmente.
- CapabilityMatrix optimista que declara capacidades no implementadas.
- `pnpm gru sync` que sobreescribe trabajo manual en `.claude/`.
- Detección de harness incorrecta que pone en modo equivocado.
- Divergencia entre adapters si no hay tests de integración reales.

Mitigacion:
- `execute()` de cada adapter debe tener un test que falla si abre conexión SDK.
- `supports()` debe ser conservador: falso por defecto, verdadero solo cuando implementado.
- `pnpm gru sync` siempre muestra diff y requiere confirmación o `--force`.
- `detectHarness()` falla a `standalone` si hay ambigüedad (fail-safe).
- Fase por fase, nunca integrar adapter sin test.

## Dependencias

- Parche de contención: ya aplicado en `packages/providers/deepagents/src/index.ts`.
- `HarnessId` y `detectHarness()`: ya en `packages/shared/src/runtime/harness.ts`.
- `ProviderStatus.adapter-missing`: ya en `packages/shared/src/ports/provider.ts`.
