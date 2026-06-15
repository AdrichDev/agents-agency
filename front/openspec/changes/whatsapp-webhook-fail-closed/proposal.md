# Propuesta — WhatsApp Webhook Fail-Closed

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **2** (Medium) · Pilar: 6 (seguridad)

## Intención

El webhook receptor de WhatsApp (`POST /api/channels/whatsapp/:agentId`) valida
la firma HMAC de Meta SOLO si `META_APP_SECRET` está configurado; si no, **omite
la validación y procesa el mensaje** (fail-open). Además, con secreto configurado
pero sin `rawBody`, también sigue (solo warn). Resultado: un atacante que conozca
la URL puede inyectar mensajes falsos (spoofing) → el bot responde, dispara IA,
consume saldo y mete datos basura.

Fix: **fail-closed**. Sin secreto, sin `rawBody` o con firma inválida → `403`,
nunca se procesa el evento.

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/routes/channels.ts` | Modificado | Webhook WhatsApp rechaza si no puede verificar la firma |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Romper recepción si falta el secreto en prod | Media | Es el comportamiento correcto: sin secreto NO se debe procesar; se documenta que `META_APP_SECRET` es obligatorio para WhatsApp |

## Criterios de éxito

- [x] Sin `META_APP_SECRET`: webhook responde `403` (no procesa).
- [x] Con secreto pero sin `rawBody` o firma inválida: `403`.
- [x] Con secreto y firma válida: procesa normal.
- [x] `vitest` (352) y `tsc --noEmit` (back) verdes.
