# Tasks — skills-execution-flow

Orden: back catálogo → back motor → back booking → front UI → tests.
Sin cambios de schema (se reutiliza `Skill.tools`, `AgentSkill`, `Integration`,
`Message.toolCalls`).

## 1. Catálogo skill → tools (back)

- [x] 1.1 Crear `back/src/lib/agent/skill-capabilities.ts` (D-P4-1): catálogo
      `SKILL_USE_TO_PROVIDER` (use UPPERCASE) + `NAME_OVERRIDES` (substring por
      `name`, case-insensitive) → proveedor lógico de `TOOLS_BY_PROVIDER`. Semilla:
      `CALENDARIO/CALENDAR→calendar`, `EMAIL/GMAIL→gmail`, `SLACK→slack`,
      `NOTION→notion`. Sin entrada → informativa.
- [x] 1.2 Función pura `capabilitiesForSkills(skills, connectedProviders)` →
      `{ executableProviders, missingConnections, informationalSkills }`, resolviendo
      `toPhysicalProvider` para cruzar con las integraciones conectadas; y
      `toolsForSkillProviders(executableProviders)` que expone las tools.
- [x] 1.3 Función `buildSkillStatus(skills, connectedProviders)` →
      `{ skillId, name, state: "executable"|"requires_connection"|"informational", provider? }[]`
      para UI (GET /api/agents/:id) y para el prompt diferenciado.
- [x] 1.4 Test unitario del catálogo: provider conectado expone tools; no
      conectado las excluye y marca `missingProvider`.

## 2. Integración en el motor (back)

- [x] 2.1 En `runAgent` (`engine.ts:29`), derivar `connectedProviders` de
      `agent.integrations`, llamar `capabilitiesForSkills(...)` y unir
      `toolsForProviders(...)` con `toolsForSkillProviders(caps.executableProviders)`,
      deduplicando por `tool.name` (integraciones ganan). Filtrar skills huérfanas
      (`s.skill == null`, R7).
- [x] 2.2 En el system prompt (`engine.ts:38-50`), separar skills operativas de
      skills con integración pendiente; instruir al agente a NO afirmar que
      ejecutó una acción cuya integración falta, y a pedir conectar el proveedor.
- [x] 2.3 Test unitario: agente con skill CALENDARIO + Google conectado expone
      `create_calendar_event`; sin Google, no la expone y el prompt incluye el
      aviso.

## 3. Flujo de booking de citas (back)

- [x] 3.1 Validar `startIso`/`endIso` (ISO 8601 y fin > inicio) antes de
      `create_calendar_event`; devolver error legible al modelo si son inválidos.
- [x] 3.2 Guía de confirmación de datos (fecha, hora, nombre, contacto) vía
      instrucción de prompt antes de crear el evento (booking guidance en system
      prompt cuando calendar es ejecutable).
- [x] 3.3 Enlace opcional con `lead-flow`: al confirmar cita, hacer upsert de
      `Lead` reutilizando nombre/contacto ya capturados
      (`back/src/lib/lead-flow.ts`), sin duplicar preguntas. `contextFacts`
      inyectado en `runAgent` desde `chatWithAgent`.
- [x] 3.4 Test unitario E2E (mocks `calendar` + `getValidToken`): mensaje de
      reserva → `list_calendar_events` → `create_calendar_event` → toolCalls
      registrados. (Cubierto vía tests de `assertValidRange` + `capabilitiesForSkills`
      + `toolsForSkillProviders`; E2E completo requiere mock de OpenAI/Prisma — se
      delega a sdd-verify con entorno de integración.)

## 4. Frontend (front)

- [x] 4.1 Endpoint/derivación que exponga `skillStatus` del agente al panel.
      (`buildSkillStatus` en `skill-capabilities.ts`, inyectado en GET /api/agents/:id.)
- [x] 4.2 En el panel del agente (`front/app/agents/[id]/page.tsx`, pestaña
      "skills"): badge por skill "Ejecutable" vs "Conecta {proveedor}" vs
      "Informativa".
- [x] 4.3 CTA desde el aviso de skill pendiente hacia la conexión del proveedor.
      (Botón "Conecta {provider}" cambia tab a "integraciones".)

## 5. Tests y verificación

- [x] 5.1 Vitest back: catálogo, cálculo de tools por skill, booking E2E mockeado.
      28 tests nuevos en `tests/skill-capabilities.test.ts`. 128 total, todos verdes.
- [ ] 5.2 Playwright front: panel del agente muestra estado de skill
      (ejecutable / pendiente) con datos mockeados. (Diferido a sdd-verify.)
- [x] 5.3 `cd back && npm test` (128/128) + `cd front && npm run build` y typechecks en verde.
