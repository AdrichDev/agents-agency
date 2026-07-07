# Diseño: bundle MCP `citas` responde 404 en n8n

## Enfoque técnico

No hay cambio de código en `agents-agency` ni en `OpenClaw_Agents`: el fix vive enteramente en
el estado operativo de la instancia n8n (importar/activar el workflow que expone
`/mcp/citas`). El bundle MCP del gateway (`bundle-mcp`) ya está correctamente configurado —
apunta a `http://n8n:5680/mcp/citas` y las tools `citas__*` ya están en `tools.alsoAllow`.

## Decisiones de arquitectura

| Decisión | Elección | Alternativas consideradas | Motivo |
|----------|----------|---------------------------|--------|
| Dónde arreglar | Instancia n8n (activar/importar workflow) | Cambiar la URL del bundle en config OpenClaw | La URL y el contrato ya son correctos (confirmado: DNS resuelve tras el fix de red); falta el recurso en destino, no el cliente. |
| Alcance del fix | Solo el workflow `citas` | Reconstruir toda la infraestructura n8n | El resto de n8n (healthz, DB) ya está sano tras el `force-recreate`. |

## Flujo de datos

    OpenClaw gateway (bundle-mcp)
            │ SSE GET/POST
            ▼
    n8n :5680/mcp/citas  ←── (workflow debe existir + estar activo)
            │
            ▼
    tools citas__crear_cita / citas__disponibilidad / citas__stock_bajo

## Cambios de archivos

Ninguno en repos versionados. Cambio operativo: estado de workflows en la instancia n8n
(`openclaw_3a_n8n`, volumen `openclaw_3a_n8n_data`).

## Interfaces y contratos

- El contrato SSE de `/mcp/citas` ya lo define el propio workflow n8n (protocolo MCP estándar);
  no se modifica aquí.

## Estrategia de pruebas

| Capa | Qué probar | Enfoque |
|------|------------|---------|
| Infra | Bundle arranca sin error | `docker logs OpenClaw_Agents_3A` tras restart del gateway |
| Integración | Tool responde datos reales | Smoke manual invocando `citas__disponibilidad` desde una sesión de agente |

## Migración y despliegue

Ninguna migración. Cambio aplicado directamente sobre la instancia n8n en ejecución.

## Preguntas abiertas

- [ ] Confirmar si el workflow tiene un export JSON versionado en algún repo para poder
      reimportarlo de forma reproducible ante futuros `force-recreate`.
