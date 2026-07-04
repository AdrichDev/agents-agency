# Dise?o ? generaci?n IA del CRM v?a AA

## Technical Approach

El cambio normaliza el flujo CRM?AA como llamada server-to-server: el CRM conserva el `AA_SERVICE_TOKEN` en su servidor y AA lo acepta solo en los endpoints de generaci?n. No se introduce metering de tokens por tenant; la generaci?n se trata como coste de plataforma.

## Architecture Decisions

| Decisi?n | Elecci?n | Alternativas | Raz?n |
|---|---|---|---|
| Auth de servicio | `isServiceCall(method, path, authHeader, serviceToken?)` con comparaci?n en tiempo constante | Reusar JWT Supabase o abrir rutas p?blicas | El CRM llama desde servidor, no hay usuario AA; el scope queda limitado a 3 paths. |
| Sin `req.user` sint?tico | El gate solo hace `next()` para rutas permitidas | Inyectar usuario ficticio | Los handlers no necesitan usuario; inventarlo ampliar?a superficie de seguridad. |
| Sin token metering | No llamar `deductTokens`, `checkClientBalance` ni `TokenUsage` | Cobrar al cupo del tenant / 402 | Decisi?n de producto: el coste de estas generaciones es de plataforma. |
| `reasoning_effort` condicionado | Enviar effort solo para modelos `gpt-5*`; mapear `minimal` a `low` | Pasarlo siempre | Evita par?metros inv?lidos en modelos que no lo soportan. |

## Data Flow

```text
CRM server
  ?? POST /api/ai/{marketing-plan|generate} + Bearer AA_SERVICE_TOKEN
       ?? AA index.ts auth gate
            ?? isServiceCall=true para path permitido ? routes/ai.ts
            ?? isServiceCall=false ? JWT Supabase normal
                 ?? OpenAI ? { content, usage }
```

## File Changes

| File | Action | Description |
|---|---|---|
| `agents-agency/back/src/lib/public-routes.ts` | Modify/Create | `SERVICE_RULES` e `isServiceCall()` testeable con DI de token. |
| `agents-agency/back/src/index.ts` | Modify | Bypass m?nimo del gate JWT solo para rutas de servicio permitidas. |
| `agents-agency/back/src/routes/ai.ts` | Modify | Handlers `marketing-plan` y `generate`, `runGeneration()`, respuesta `{content, usage}`. |
| `agents-agency/back/tests/public-routes.test.ts` | Create/Modify | Cobertura del gate de servicio y casos negativos. |

## Interfaces / Contracts

- Request: `{ model?: string, effort?: string, prompt: string }`.
- Response OK: `{ content: string, usage: { tokens?: number, model?: string } }`.
- Auth: `Authorization: Bearer <AA_SERVICE_TOKEN>` solo en servidor.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `isServiceCall` acepta solo m?todo/path/token correctos | Vitest con token inyectado. |
| Integration | Gate no abre rutas ajenas | Tests de paths negativos. |
| Smoke | CRM?AA con env real | Pendiente hasta configurar `AA_SERVICE_TOKEN` en ambos servidores. |

## Migration / Rollout

No requiere migraci?n DB. Rollout por configuraci?n: definir el mismo `AA_SERVICE_TOKEN` en AA back y CRM front server, y `AA_API_URL` en CRM.

## Open Questions

- [ ] Ejecutar smoke end-to-end CRM?AA cuando el usuario configure variables de entorno.
