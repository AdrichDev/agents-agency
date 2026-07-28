# Spec: Token Metering CRM → AA

## Overview

Mensura consumo de tokens por tenant (cliente) en agencia cuando operan sobre creador_CRM (generan proyectos, crean estudios, usan IA sectorial). El CRM requiere tokens; AA billea según consumo.

## Requerimientos

### R1 — Metering point: generación de proyecto

**Cuando** el operador (o usuario final del CRM) genera proyecto (paquete tarjetas/módulos),
**Entonces** POST /service/operator/proyectos + design.config consume tokens del tenant según:
- tokens_base: 100 (fijo por proyecto nuevo)
- tokens_por_modulo: 50 (cada módulo seleccionado)
- Ej: proyecto con 3 módulos = 100 + (3 × 50) = 250 tokens

**Llamador**: creador_CRM back POST /service/operator/proyectos, requiere token válido (OPERATOR_SERVICE_TOKEN). Si llamador tiene tenantId explícito, deducir del tenant especificado. Si es admin (no hay tenantId), deducir del token del operador (Adrian).

**Fallback**: si tenant no existe, 422 (validado ya en create-project-service). Si tokens insuficientes, 402 Payment Required (después de validar tenantId).

### R2 — Deducción atómica

Deducir tokens DESPUÉS de proyecto creado exitosamente (no antes). Si deducción falla (BD down), loguear pero NO deshacer proyecto. Operación debe ser `withCodeRetry` pattern (reintentar 3×).

### R3 — Registro auditable

Crear fila en aa.tokenUsage: `{tenantId, operation: 'crm_generate', tokensUsed: X, context: {projectId, modulesCount}, createdAt}`. Sin logs de deducción en stdout — solo DB.

### R4 — Scope futuro (NO en esta spec)

- Otros consumos CRM (estudios, IA sectorial): TODO futuro
- SMS/push desde CRM: NO meterá tokens (vía n8n, no del CRM)
- Limite suave (warning): TODO
- Factura por tokens: TODO

## Acceptance Criteria

**AC1** — Generación exitosa deduce tokens: `POST /projects {tenantId, config} → 201 + tokenUsage creada`.

**AC2** — Fallback insuficientes: `POST /projects {tenantId, config} con saldo < costo → 402 Payment Required + 0 tokens deducidos`.

**AC3** — Auditoría: fila tokenUsage tiene operación, tokens, contexto, timestamp.

**AC4** — Resolución de tenantId por fallback deduce correctamente: `POST /service/operator/proyectos {config, sin tenantId en body}` con `tenantId` resoluble via `config.business.clienteId` → se cobra sobre ESE tenantId. Corrección post-verificación de código: `crearProyectoHandler` siempre exige un `tenantId` resuelto (body o fallback) y devuelve 422 `tenant_required` si ninguno está presente — no existe un concepto de "tenant del operador" en el modelo de datos (`OPERATOR_OWNER_USER_ID` es un `usuario` CRM, no un `aa.tenant.id`). Un modo real "sin tenant, cobra al operador" sería un cambio de spec nuevo, fuera de alcance.

## Interfaces

```ts
// En creador_CRM back, routes/service-operator.ts POST /proyectos
interface ProjectChargeRequest {
  config: ProjectConfig;
  tenantId?: string; // Para admin, buscar del token operador
  confirmado: boolean; // Requerido (protocolo operador)
}

// Response success + cargo
interface ProjectChargeResponse {
  id: string; // business.id
  config: ProjectConfig;
  createdAt: string;
  tokensDeducted: number; // Info al operador
}

// En agents-agency, lib/billing.ts NUEVA
export function calculateProjectCost(config: ProjectConfig): number {
  const modulesCount = config.modules?.length ?? 0;
  return 100 + modulesCount * 50;
}

export async function chargeTokensForProject(
  tenantId: string,
  cost: number,
  context: { projectId: string; modulesCount: number },
) {
  // Deducir tenantId.saldoTokens
  // Crear aa.tokenUsage fila
  // withCodeRetry 3×
}
```

## Risk

- Falla deducción post-creación: proyecto existe pero tokens no deducidos. Mitigation: logging + manual reconciliation dashboard futuro.
- Race condition: mismo tenant 2 POST simultáneos. Mitigation: tokenUsage es aditivo, saldo check es snapshot (eventual consistency OK).

## Timeline

- L1 spec: 2026-07-04
- L2 design: definir retry strategy, logging verbosity
- L3 apply: crear migration, implement chargeTokensForProject, integrate en POST /proyectos
- L4 verify: e2e test, token saldo decrece real
