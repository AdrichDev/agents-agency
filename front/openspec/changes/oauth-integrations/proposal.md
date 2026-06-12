# Proposal — oauth-integrations

Canal objetivo: **oauth**

## Intención

La pestaña Integraciones debe ofrecer **conexiones OAuth reales** para que los
agentes y las automatizaciones actúen sobre servicios externos (leer Gmail,
crear eventos de Calendar, publicar en Slack, escribir en Notion…).

Estado actual: ya existe una base parcial (`back/src/lib/integrations/oauth.ts`
con providers gmail/calendar/slack/jira, modelo `Integration`, endpoints
`/api/oauth/:provider` y callback). Esta fase **completa y endurece** ese
trabajo, no parte de cero.

Proveedores de la fase inicial:

- **Google** (Calendar + Gmail) — un único flujo OAuth con ambos scopes, no dos
  conexiones separadas como hoy.
- **Slack** — ya presente; revisar scopes y estado UI.
- **Notion** — **nuevo**, falta en `PROVIDERS`.

Fase posterior (documentada, no implementada aquí):

- **Jira** — ya presente parcialmente; consolidar.
- **Instagram Graph** — requiere Facebook App + cuenta business.

Éxito = el cliente pulsa "Conectar" en un proveedor, completa el OAuth, y la
conexión queda guardada (tokens cifrados, refresh automático), visible como
"conectado" y usable por las acciones del catálogo SERVICES.

## Alcance (in-scope)

- **Flujo unificado de Google**: un solo provider `google` con scopes de
  Calendar + Gmail; deprecar los providers separados `gmail`/`calendar` (o
  mapearlos al unificado sin romper datos existentes).
- **Notion** como nuevo provider en `PROVIDERS` (authUrl, tokenUrl, scopes).
- **Cifrado de tokens en reposo**: reutilizar la utilidad `crypto.ts`
  (AES-256-GCM) introducida en `telegram-whatsapp-bots`. Cifrar `accessToken` y
  `refreshToken` del modelo `Integration` (hoy en claro).
- **Refresh automático**: ya existe `getAccessToken`; ajustarlo a tokens cifrados.
- **UI de estado por proveedor**: conectado/desconectado, botón conectar y
  desconectar, etiqueta de cuenta/equipo cuando exista.
- **Mapeo SERVICES → conexiones**: el catálogo `SERVICES` de
  `AutomationsPanel.tsx` (google_calendar, gmail, slack, notion, jira, instagram)
  debe resolver cada `service` a una conexión OAuth concreta del agente, y
  señalar visualmente si falta conectar el servicio que la acción requiere.

## Fuera de alcance (out-of-scope)

- Publicación móvil nativa.
- Apps de marketplace de terceros / distribución pública de la app OAuth.
- Implementación funcional de Jira e Instagram (solo se dejan documentados).
- Gestión de scopes incrementales por acción.

## Enfoque

1. **Reutilizar cifrado**: dependencia de la utilidad `crypto.ts` (definir esta
   fase como posterior o paralela a `telegram-whatsapp-bots`).
2. **Providers**: refactor de `PROVIDERS` en `oauth.ts` → `google` unificado,
   añadir `notion`; documentar `jira`/`instagram`.
3. **Persistencia**: cifrar tokens al guardar en `Integration` (upsert) y
   descifrar en `getAccessToken`. Migración de datos existentes en claro.
4. **Refresh**: validar caducidad y refrescar transparentemente (Google rota
   refresh tokens en algunos casos; manejarlo).
5. **Mapeo de acciones**: tabla `service → provider` compartida entre front
   (`AutomationsPanel`) y back (motor de automations); el back ya filtra por
   provider conectado en `automations/engine.ts`.
6. **Frontend**: panel de Integraciones con estado real por proveedor.

## Riesgos / preguntas abiertas

- **Migración de tokens en claro**: al introducir cifrado, los `Integration`
  existentes tienen `accessToken` en texto plano. Decidir: re-cifrar en
  migración vs. forzar reconexión. Riesgo de invalidar integraciones activas.
- **Google unificado vs. providers separados**: hoy `gmail` y `calendar` son
  providers distintos con `@@unique([agentId, provider])`. Unificar requiere
  plan de migración de filas (`provider = "google"`).
- **Verify de apps OAuth**: Google/Slack/Notion exigen app registrada con
  redirect URIs; en local hace falta URL pública. Documentar en `docs/SETUP-OAUTH.md`.
- **Refresh de Slack**: los bot tokens de Slack no caducan; lógica de refresh no
  aplica igual que en Google. No forzar refresh donde no procede.
- **Rollback de schema**: si se añaden columnas a `Integration`, prever rollback;
  el cifrado de columnas existentes no cambia el esquema (mismo tipo `String`).
- **Mapeo SERVICES**: `instagram`/`jira` aparecen en el catálogo UI pero no se
  conectarán en esta fase; deben mostrarse como "próximamente" para no confundir.
