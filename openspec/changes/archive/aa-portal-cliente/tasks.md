# Tareas — aa-portal-cliente (H5)

**Nivel 4 (crítico).** Auth/seguridad + migración + back y front. Requiere aprobación humana antes
de codear y revisión antes de cualquier push.

**Orden crítico:** T1 → T2 → T3 → T4. T2 antes de T3 no es preferencia: si los endpoints de portal
existen antes que la puerta, hay una ventana en la que un `client` alcanza todo `/api`. T5 va al
final porque hasta que la puerta y los endpoints existan, crear un usuario de portal es crear un
usuario que puede entrar a lo que no debe.

---

## T1 — Modelo y migración

- [x] **T1.1** `User.tenantId String? @map("tenant_id")` + relación a `Tenant` con
  `onDelete: Restrict` + `@@index([tenantId])` en `back/prisma/schema.prisma`. Añadir `client` al
  comentario de valores de `role`.
- [x] **T1.2** Añadir `tenantId` a `SessionUser` (`back/src/lib/auth.ts:94`) y al `select`/inyección
  del gate de auth (`back/src/index.ts:161-171`). Sin esto la puerta no tiene con qué filtrar.
- [x] **T1.3** Migración `back/prisma/migrations/<ts>_usuario_tenant_id/migration.sql`: `ADD COLUMN`
  nullable, FK con `ON DELETE RESTRICT`, `CREATE INDEX`. **Nada de `NOT NULL`, nada de default.**
- [x] **T1.4** Test: `back/tests/portal-migracion-aditiva.test.ts` — la columna es nullable y sin
  default en el schema, y la migración no contiene `NOT NULL` ni `SET DEFAULT` sobre `tenant_id`.
- [x] **T1.5 (gate)** Aplicar la migración. Antes: contar usuarios existentes y confirmar que todos
  quedan con `tenant_id` NULL (= staff, comportamiento de hoy). **Hecho el 27/07/2026 con aprobación
  del propietario:** 1 usuario en producción (`achozas9@gmail.com`, `admin`), la columna no existía;
  aplicada con `migrate deploy` (13 migraciones, esquema al día) y verificado después: 1 de 1 con
  `tenant_id = NULL`. Nadie cambia de comportamiento.

## T2 — La puerta deny-by-default

- [x] **T2.1** `back/src/lib/client-routes.ts`: `CLIENT_RULES` + `isClientAllowed(method, path)`,
  puro y sin dependencias de Express. Mismo patrón que `public-routes.ts`, que ya se testea así.
  Única regla inicial: `GET` bajo `/api/portal`.
- [x] **T2.2** `back/src/lib/client-scope.ts` (no `src/middleware/`: en este repo no existe esa
  carpeta y todos los middlewares viven en `src/lib`): `clientScopeGate`. Orden interno exacto —
  público pasa; rol distinto de `client` pasa; `client` sin `tenantId` ⇒ 403; ruta no permitida
  ⇒ 403.
- [x] **T2.3** Montarlo en `back/src/index.ts` **entre** el gate de auth (termina en la línea 185) y
  el montaje de routers (empieza en la 187). Comentario explicando por qué va exactamente ahí.
- [x] **T2.4** Test: `back/tests/portal-puerta-cliente.test.ts` — AC1, AC2, AC5, AC6, AC11
  (escenarios E2, E3, E4, E6). Incluye una ruta inventada, que es la que demuestra que los routers
  futuros nacen cerrados.

## T3 — Endpoints del portal

- [x] **T3.1** `back/src/routes/portal.ts` con los cuatro `GET` del design §C. El `tenantId` sale
  **siempre** de `req.user`; ninguna firma acepta un tenant por request. `tenantOf(req)` no recibe
  ningún parámetro de la petición, y los handlers repiten la comprobación que ya hace la puerta: son
  alcanzables por staff, y un router que confía en un middleware montado en otro fichero se rompe en
  silencio el día que alguien lo monta en otro sitio.
- [x] **T3.2** `GET /api/portal/me`: tenant, plan (`codigo` + nombre), periodo, consumo, cupo y
  restante. El cupo se resuelve con `resolveTokenQuota` de H4 — **no** se recalcula. **Ojo tras H7:**
  un tenant sin plan ya no tiene cupo cero, tiene el cupo por defecto de la plataforma
  (`quotaSource = "default"`). El portal enseña el cupo real y el aviso (`quotaWarning`), no "sin
  plan, cero disponible", que sería mentira desde H7. **En byok `warning` es `null`**, no `"ok"`:
  misma corrección que se hizo en H7 T4.1 sobre `/api/clients`, por el mismo motivo (el gate no
  aplica tope en byok, así que cualquier porcentaje se mide contra un techo inexistente).
- [x] **T3.3** `GET /api/portal/agents`: sólo `published` y `suspended`
  (`VISIBLE_STATUSES = BILLABLE_STATUSES`, lo que se cobra es lo que se ve), con consumo del periodo
  por agente vía `sumAgentPeriodUsage` de H4 T5. El `select` no incluye `systemPrompt`, `publicKey`
  ni el modelo.
- [x] **T3.4** Conversaciones y mensajes, con scoping por join a `Agent` (`Conversation` no tiene
  `tenantId`) y `isTest = false`. Paginado por cursor con `limit` acotado a 100. `toolCalls` fuera
  del `select`.
- [x] **T3.5** Recurso de otro tenant ⇒ **404**, no 403. El filtro por tenant va en el `where` de la
  consulta, no en un `if` posterior: así no existe la versión de este código que lee la fila primero
  y decide después.
- [x] **T3.6** Test: `back/tests/portal-endpoints-aislamiento.test.ts` — 24 tests. Asertan el `where`
  que llega a Prisma, no sólo el status: un 200 no distingue "filtró bien" de "no filtró nada".
  Cubre E1 (404 + cuerpo `{error}` y sin llegar a listar), AC4 (`?tenantId=` y `tenantId` en body
  ignorados en `/me` y `/agents`), E5 (aviso coherente con el corte del gate: `warn90`, `exhausted`
  con `tokenBalance = 0`, `null` en byok, defecto de H7 sin plan), AC8 (`status.in` sin `draft`/
  `archived`, `isTest: false`) y AC9 (ni un importe en la respuesta).

## T4 — Front

- [x] **T4.1** `front/app/portal/page.tsx`: plan, tarifa (desde `SERVICES_CATALOG` cruzando
  `Plan.codigo`), consumo del periodo y cupo restante.
  Contratos y helpers puros en `front/lib/portal.ts` (`tarifaDePlan`, `conIva`,
  `porcentajeConsumido`, `textoAviso`). La pantalla **no recalcula el cupo**: el restante y el nivel
  de aviso vienen resueltos del back con la misma función que usa el gate, porque una segunda cuenta
  en el navegador crea un consumo exacto en el que el portal dice "te queda saldo" mientras el agente
  ya devuelve 402. En `byok` no se enseña aviso ni porcentaje (`warning` es `null`). Sin entrada en el
  catálogo no hay importe: se dice "consulta con el estudio" en vez de caer a una tarifa aproximada.
- [x] **T4.2** `front/app/portal/agentes/[id]/page.tsx`: conversaciones del agente y detalle.
  Lista con paginación por cursor (`limit=20` + "Cargar más", acumula en vez de reemplazar) y panel de
  mensajes. El 404 del back se enseña como "Asistente no encontrado", sin distinguir "no existe" de
  "no es tuyo": un mensaje distinto le confirmaría al cliente que ese ID existe en otra cuenta.
- [x] **T4.3** `PORTAL_NAV` en `front/lib/navigation.ts` y elección de menú por rol en el layout.
  `NAV_GROUPS` (menú del estudio) no se le renderiza a un `client`.
  `navForRole()` devuelve una **lista aparte**, no un filtro sobre `NAV_GROUPS`: con un filtro, cada
  grupo nuevo que alguien añada al menú del estudio aparecería también en el del cliente hasta que se
  acordase de excluirlo. `Sidebar` pasa a recibir la sesión por props desde `AppShell` — con
  `useAuthUser` en los dos habría dos `GET /api/auth/me` por carga, contra la convención que documenta
  `TelegramWidgetGlobal.tsx`. Además se cortan en `Sidebar` las llamadas hostiles al cliente
  (`/api/contacts/pending-count`, `/api/config`) y los enlaces a Configuración y Mi Cuenta.
- [x] **T4.4** Redirección por rol: un `client` en cualquier ruta de staff va a `/portal`. Revisar
  que el guard de sesión no trate `/portal` como pública (no se toca `PUBLIC_PATHS`: `/portal`
  requiere sesión).
  En `AppShell`, con `router.replace` (no `push`: Atrás no debe devolverlo a la pantalla del estudio)
  y **reteniendo los children** mientras redirige — si se montaran, cada página de staff dispararía
  sus fetch antes de que el router cambiase de ruta. Las rutas limpias (`/`, legales) quedan fuera:
  expulsar a alguien de un aviso legal por su rol no tiene sentido. `PUBLIC_PATHS` intacto.
- [x] **T4.5** Test: `front/tests/portal-tarifa-desde-catalogo.spec.ts` — la tarifa mostrada viene
  del catálogo y la respuesta del back no trae importes (AC9).
  9 tests, estructurales (sin `page.goto`; correr con `E2E_BASE_URL` puesto para no levantar
  servidor). AC9 se audita sobre la **fuente del endpoint con los comentarios quitados**: buscar
  "precio" en el fichero entero suspendía justo al fichero que hace lo correcto, porque documenta en
  prosa que no devuelve importes. Auditar el código y no los comentarios es la diferencia entre un
  test que falla en el commit que añade el precio al payload y uno que falla siempre.

## T5 — Alta de usuario de portal

- [x] **T5.1** Endpoint de staff para crear un `User` con `role = "client"` y `tenantId`
  obligatorio. Rechazar `client` sin `tenantId` (la invariante del design §B).
  `POST /api/clients/:id/portal-users`, sólo `admin` (`requireRole`). El tenant llega **por la URL** y
  el `role` lo fija el servidor: así la fila que la invariante prohíbe no se puede pedir. Con el tenant
  en el body haría falta rechazarlo a mano, y el día que alguien olvidara la comprobación nacería un
  usuario de portal que la puerta no puede escopar. Dos escrituras en orden — primero Supabase Auth
  (que asigna el UUID que reutiliza `aa.usuario.id`) y después el perfil — con **borrado compensatorio
  de la cuenta de Auth** si el perfil falla: sin eso queda una cuenta que inicia sesión, recibe 401 en
  `/api/auth/me` para siempre y encima bloquea el reintento con el mismo email. La contraseña inicial
  la pone el estudio y no aparece en la respuesta ni en los logs.
  Dos cambios que arrastra: la política de contraseñas sale de `routes/auth.ts` a `@/lib/password`
  (duplicarla dejaría dos puertas y la débil sería la que decide), y `POST /api/auth/change-password`
  entra en la allowlist de `client-routes.ts` — sin él, la contraseña que el estudio entrega en mano
  sería la definitiva. El tripwire de T2 (`CLIENT_RULES` tiene N reglas) sube a 2 con su motivo escrito
  al lado, que es exactamente para lo que estaba puesto.
- [x] **T5.2** Test: `back/tests/portal-alta-usuario-cliente.test.ts`.
  13 tests. Se asierta el `data` que llega a Prisma, no el 201: un 201 también lo devuelve la versión
  que guarda `role: "admin"`. Cubre `tenantId` y `role` inyectados en el body (ignorados), 404 sin
  tocar Supabase, los dos 409 (email ya en la plataforma / ya en Auth), contraseña débil, 403 de rol,
  401 sin sesión y las dos ramas de la compensación. Dos fallos propios corregidos: el `.email()`
  corría antes del trim (un email pegado con un espacio daba 400 — ahora se normaliza y luego se
  valida) y pasar `undefined` como usuario activaba el valor por defecto del parámetro, así que el test
  del 401 se ejecutaba como admin.
- [x] **T5.3** Declarar como deuda: no hay pantalla para esto. Se crea por endpoint.
  Ver §5 de "lo que este change NO hace".

## Verificaciones finales

- [x] `npx tsc --noEmit` en `back/` y en `front/`.
- [x] Suite completa de `back/` verde (referencia tras H7 + T1: 127 ficheros / 1395 tests).
  Tras H5 completo: **130 ficheros / 1452 tests verdes, 3 skipped**.
- [x] `npx prisma migrate status` sin drift.
  13 migraciones, "Database schema is up to date!" contra el pooler de Supabase.
- [x] Revisión (`/code-review` o `sdd-verify`) antes de commit. **Sin push.**
  Revisión del diff completo. Un defecto encontrado y arreglado: `TelegramWidgetGlobal` se montaba en
  `/portal` — es el centro de mando del estudio y sus llamadas van a `/api/channels/*`, que la puerta
  le niega a un `client`, así que era un botón flotante que sólo sabía devolver 403. Se oculta por
  ruta, no por rol, para no añadir un segundo `GET /api/auth/me`. Commit `2082dbb` en
  `ac/aa-agente-ciclo-vida-publicacion`. **Sin push.**
- [x] Resumen de scope caveman + guardado en Engram.

## Lo que este change NO hace (declarado, no olvidado)

1. **No cobra.** Checkout, webhooks y renovación son H6.
2. **No escribe.** El portal no permite editar el agente, subir conocimiento ni borrar
   conversaciones. Si eso se quiere, es un change con su propio análisis de permisos.
3. **No unifica los catálogos de precios duplicados** (`front/components/presupuestos/types.ts:20`
   vs `back/src/lib/service-catalog.ts:14`, ya divergentes: el del back no tiene `tokens`).
4. **No siembra filas en `plan`.** La tabla sigue vacía y por H7 ya no hace falta: el portal enseña
   el cupo por defecto de la plataforma, que es lo que el gate aplica de verdad.
5. **No hay pantalla de alta** de usuarios de portal (T5.3).
