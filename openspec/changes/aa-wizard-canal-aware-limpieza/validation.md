# Validation — aa-wizard-canal-aware-limpieza

## User story

Como operador que crea y publica un agente, quiero un wizard sin pasos que dupliquen lo
que ya hago después, y una pantalla de Implementación que me muestre el canal que elegí
(no todos), para no confundirme con opciones que no apliquen (p.ej. "Widget Web" en un
agente que marqué como Telegram).

## Acceptance criteria

- **AC1**: El wizard tiene 4 pasos; el paso Skills ya no existe. Crear un agente funciona
  igual (el backend crea con 0 skills; `skillIds` omitido/`[]`). Las skills se configuran
  después en SkillsTab.
- **AC2**: La pestaña Implementación (`DeployPanel`) lee `agent.channel` y muestra el
  canal elegido de forma prominente; los canales NO elegidos quedan de-enfatizados (bajo
  un desplegable), no en primer plano.
- **AC3**: La sección API REST está siempre visible (el agente siempre es accesible por
  `publicKey`), con nota que lo aclare.
- **AC4**: Sigue siendo posible añadir un segundo canal más tarde (los otros canales
  quedan accesibles bajo el desplegable, no eliminados).
- **AC5**: "Solo API" renombrado a copy claro ("Integración por API (sin canal de chat)")
  con descripción que explique el uso.
- **AC6**: Los comentarios que decían `skillIds` "oculto/siempre []" quedan corregidos.
- **AC7 (regresión cero)**: ninguna lógica de backend cambia; la creación de agentes y la
  config de skills post-creación (SkillsTab) siguen funcionando.

## Given-When-Then

**Escenario 1 (AC2 — el bug):**
Given un agente con `channel: "telegram"`
When abro la pestaña Implementación
Then veo la sección Telegram como principal y la sección Widget NO en primer plano (queda
bajo "¿Publicar también en otro canal?"), y la API REST visible.

**Escenario 2 (AC1 — wizard limpio):**
Given el wizard de creación
When lo recorro
Then tiene 4 pasos (sin Skills) y al finalizar crea el agente correctamente.

**Escenario 3 (AC4 — no perder capacidad):**
Given un agente Telegram
When abro "¿Publicar también en otro canal?" en Implementación
Then puedo ver/activar Widget o WhatsApp como canal adicional.

## Test por tarea
- T1.1/T1.2 → `front tsc` verde; 4 pasos, sin Skills; submit crea sin skillIds.
- T2.1 → DeployPanel: telegram→Telegram principal + Widget bajo desplegable; widget→Widget principal; API siempre.
- T3.1 → copy renombrado presente.
- T4.1 → comentarios stale corregidos.

Regla del repo: DONE solo con test verde; sin spec, revertido.
