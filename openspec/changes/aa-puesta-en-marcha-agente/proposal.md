# Puesta en marcha del agente

## Intención

Que crear un agente termine en un agente que atiende a alguien, no en un borrador
que nadie vuelve a tocar.

## El problema, con datos de producción (28/07/2026)

```
agentes: 11   →  10 draft, 1 published
conexiones de canal: 0
eventos de transición de estado en toda la historia: 1
```

Los 10 borradores **no están bloqueados por nada**. Las precondiciones de
publicación (`lifecycle.ts:213-215`) son dos —cliente asignado y prompt— y los 10
las cumplen. Publicar es un clic que nadie da.

El único evento de estado registrado es de ayer (27/07 18:47) y lo hicimos
nosotros. Cuando alguien sí recorre el camino, funciona: ese agente recibió el
ping de instalación del widget **dos minutos después** de publicarse
(`widgetInstalledAt = 18:49`) y siguió vivo dos horas.

Causa directa: el wizard termina en
`router.push('/agents/${id}?tab=integraciones')` (`front/app/agents/new/page.tsx:271`)
con el agente en `draft`. Existe un aviso con botón «Ir a publicarlo →»
(`front/app/agents/[id]/page.tsx:119-134`) y en siete semanas nadie lo pulsó.

Referencia externa: el instalador de Forja (`skill/configurar-mi-chatbot.md`)
resuelve esto con cuatro fases donde **cada una remata en algo visible** y la
última es obligatoria: un mensaje real por un canal real. Nuestro flujo no tiene
ese remate.

## Alcance

1. **Contrato único de activación** en el backend: cuatro escalones
   `configurado → publicado → alcanzable → probado`, calculados en un solo sitio
   y expuestos en `GET /api/agents` y `GET /api/agents/:id`.
2. **El wizard decide el estado final**, con dos botones explícitos:
   «Crear y publicar» (principal) y «Crear como borrador».
3. **Señal agregada** en el listado de agentes y en el dashboard: cuántos agentes
   no atienden a nadie.
4. **Checklist con el siguiente paso** en la pestaña Implementación de la ficha.

## Fuera de alcance

- Cambiar el modelo de facturación. `published` sigue significando facturable
  exactamente igual que hoy.
- Migraciones. Todos los campos necesarios ya existen: `Agent.status`,
  `Agent.publishedAt`, `Agent.widgetInstalledAt`, `ChannelConnection`,
  `Conversation`/`Message`.
- Publicar agentes existentes de forma automática. Los 10 borradores actuales se
  quedan como están; el cambio afecta al flujo, no retroactivamente a los datos.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Publicar desde el wizard empieza a facturar sin que el dueño lo entienda | Dos botones separados y con texto explícito; nunca una sola acción ambigua. Además `POST /:id/unpublish` ya existe y es reversible |
| El escalón «probado» cuenta al propio dueño probando el agente | Sólo cuentan conversaciones con `isTest = false` **y** `createdAt > publishedAt`. No es prueba de que sea un cliente real —`isTest=false` sólo excluye la consola de pruebas— y así se documenta en el copy: el escalón dice «ha recibido tráfico», no «lo usó un cliente» |
| Tocar el wizard rompe el borrador local (`clearDraft`) | El wizard conserva su flujo actual; sólo cambia la acción final |

## Dependencias

Ninguna nueva. Consume `checkPublishPreconditions` (ya existe),
`transitionAgentStatus` (ya existe) y el ping de instalación del widget
(F7 de `aa-agent-backend-foundation`, ya en producción).
