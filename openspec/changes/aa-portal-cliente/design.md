# Diseño — aa-portal-cliente (H5)

## A. La decisión que gobierna el change: deny-by-default, no allowlist por router

### A.1 Por qué no `requireRole` en cada router

`requireRole` (`back/src/lib/auth.ts:107`) es un middleware que se monta por ruta. Hoy hay **un**
call-site (`back/src/routes/config.ts:88`) y ~25 routers montados en `back/src/index.ts:190-262`.

Aplicarlo router por router tiene un modo de fallo asimétrico:

| | Olvidar añadirlo | Añadirlo de más |
|---|---|---|
| Consecuencia | Un cliente lee datos de otro cliente | Un endpoint devuelve 403 y alguien lo reporta |
| Cuándo se descubre | Cuando el cliente lo cuenta | En el primer clic |

Un diseño donde el olvido abre la puerta es un diseño malo, por muy correcto que sea el código el
día que se escribe. Y el olvido no es hipotético: el próximo router lo escribirá alguien que no
leyó este documento.

### A.2 La puerta

Un único middleware montado en `/api` **después** del gate de autenticación
(`back/src/index.ts:130-185`) y **antes** de montar los routers (línea 187):

```ts
// back/src/index.ts, entre el gate de auth y el montaje de routers
app.use("/api", clientScopeGate);
```

```ts
// back/src/lib/client-routes.ts — puro, testeable sin arrancar el server.
// Mismo patrón que public-routes.ts (isPublic / PUBLIC_RULES), que ya existe y ya se testea así.
export const CLIENT_RULES: ClientRule[] = [
  { method: "GET", pattern: /^\/api\/portal(\/|$)/ },
];

export function isClientAllowed(method: string, path: string): boolean { … }
```

```ts
// back/src/middleware/client-scope.ts
export function clientScopeGate(req, res, next) {
  const fullPath = req.originalUrl.split("?")[0];
  if (isPublic(req.method, fullPath)) return next();   // lo público sigue siendo público
  if (req.user?.role !== "client") return next();      // staff: comportamiento idéntico a hoy

  // Un `client` sin tenant no es "un cliente sin filtro": es un usuario mal creado.
  if (!req.user.tenantId) return res.status(403).json({ error: "Permisos insuficientes" });

  if (!isClientAllowed(req.method, fullPath)) {
    return res.status(403).json({ error: "Permisos insuficientes" });
  }
  next();
}
```

Propiedades que compra esto:

1. **Un router nuevo nace cerrado** para clientes. No hay nada que recordar.
2. **El staff no cambia.** Si el rol no es `client`, la puerta llama a `next()` y punto. Regresión
   cero para los 15 tenants y los usuarios actuales.
3. Es **una** regla en **un** sitio, y se puede leer entera de un tirón.
4. Sólo `GET` bajo `/api/portal`. El portal es de lectura por construcción, no por disciplina: un
   `POST /api/portal/...` que alguien añada mañana está prohibido por la regla, no por una
   convención.

## B. Modelo de datos

```prisma
model User {
  …
  role     String  @default("admin") @map("rol")   // admin | editor | viewer | client
  // H5 — Tenant al que pertenece el usuario. NULL = staff de la plataforma (admin/editor/viewer):
  // ve todo, que es el comportamiento actual y no cambia. NOT NULL = usuario de portal, y todo lo
  // que lea sale filtrado por este valor. Nunca por un tenantId del request.
  tenantId String? @map("tenant_id")
  tenant   Tenant? @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@index([tenantId])
}
```

Decisiones:

- **Nullable, no NOT NULL con default.** No existe un tenant "por defecto" al que asignar a los
  usuarios de staff actuales, y `NULL` dice exactamente lo que queremos decir: *este usuario no
  pertenece a un tenant, pertenece a la plataforma*. Migración aditiva pura.
- **`onDelete: Restrict`.** Borrar un tenant que todavía tiene usuarios de portal debe fallar
  ruidosamente. Un `Cascade` borraría personas junto con la empresa; un `SetNull` convertiría a un
  `client` en un usuario sin tenant, que es el estado que la puerta trata como error.
- **Sin columna nueva para el rol.** `role` ya es `String` libre; `client` es un valor más. Cambiar
  a enum es un change aparte y arrastraría los tres roles existentes.
- **La invariante `role='client' ⇒ tenantId NOT NULL` se comprueba en la aplicación**, no con un
  CHECK: Prisma no modela CHECKs y meterlo a mano en la migración lo deja invisible en el schema,
  que es peor que no tenerlo. Se cierra en dos sitios: en el endpoint que crea el usuario y en la
  puerta (que con `tenantId` nulo devuelve 403, nunca deja pasar).

## C. Endpoints del portal

Todos `GET`, todos bajo `/api/portal`, todos con el `tenantId` **de `req.user`**. Ninguno acepta un
`tenantId` por query, body o path. Ese es el invariante de aislamiento y es lo que verifica el test
negativo.

| Endpoint | Devuelve | Filtro |
|---|---|---|
| `GET /api/portal/me` | nombre del tenant, plan (`codigo`, `nombre`), periodo vigente, consumo del periodo, cupo resuelto y restante | `tenant.id = session.tenantId` |
| `GET /api/portal/agents` | sus agentes **publicados o suspendidos**, con nombre, estado, canales y consumo del periodo | `agent.tenantId = session.tenantId` + `status in (published, suspended)` |
| `GET /api/portal/agents/:id/conversations` | conversaciones paginadas, sin las de consola | join `agent.tenantId = session.tenantId` + `conversation.isTest = false` |
| `GET /api/portal/conversations/:id/messages` | mensajes de una conversación | mismo join, vía `conversation.agent.tenantId` |

Notas de diseño:

- **`Conversation` no tiene `tenantId`** (`back/prisma/schema.prisma:516-531`): sólo `agentId`. El
  scoping va por join a `Agent`. No se añade una columna denormalizada: sería un segundo sitio
  donde el tenant de una conversación puede estar mal, y el error se manifestaría como fuga.
- **`isTest = false`** reutiliza la exclusión que ya definió `aa-agente-consola-pruebas` (T1.3): las
  conversaciones de la consola del operador no son del cliente y no se le muestran.
- **`draft` y `archived` no se listan.** Un borrador es trabajo interno; enseñarlo invita a
  preguntar por algo que no se ha entregado.
- **Recurso de otro tenant ⇒ 404, no 403.** Un 403 confirma que el id existe. El portal responde
  como si no existiera, porque para ese cliente no existe.
- El cupo se resuelve con `resolveTokenQuota` de H4 (`back/src/lib/quota.ts`), no con una copia. El
  portal debe enseñar **el mismo número que aplica el gate**; si divergen, el cliente ve "te queda
  cupo" y recibe un 402.

## D. Dinero: qué enseña el portal y de dónde lo saca

El portal enseña **el nombre del plan y su tarifa**, no un importe guardado en la base.

```
Plan.codigo  ──match──▶  SERVICES_CATALOG[].id   (front/components/presupuestos/types.ts:20)
                              │
                              ├─ implPrice   (puesta en marcha, pago único)
                              └─ maintPrice  (mantenimiento / mes)
```

`Plan.codigo` ya existe en el schema (`back/prisma/schema.prisma:131`) como *"identificador estable
usado por código"*. Es el puente y no hay que crear nada.

Por qué así:

- La **lista de tarifas** ya existe y es una sola (`SERVICES_CATALOG`, la misma que alimenta
  `/tarifas` y los presupuestos). El portal la lee; no la duplica.
- El **importe que se cobra** lo pondrá Stripe en H6. Guardar un `precio` en `Plan` crearía una
  tercera copia y la pregunta sin respuesta de cuál es la buena cuando difieran.
- Consecuencia práctica: cambiar una tarifa sigue siendo editar una lista, no una migración.

**Deuda encontrada (no creada aquí, no arreglada aquí):** el catálogo está duplicado a mano en
`front/components/presupuestos/types.ts:20` y `back/src/lib/service-catalog.ts:14` — el propio
fichero lo admite (*"kept in sync manually"*) — y la copia del back **no tiene el campo `tokens`**,
o sea que ya han divergido. H5 consume sólo la del front, que es la completa. Unificar es su propio
change.

## E. Front

- Rutas nuevas: `/portal` (resumen: plan, consumo, cupo restante) y `/portal/agentes/[id]`
  (conversaciones del agente y su detalle).
- **Navegación propia.** `NAV_GROUPS` (`front/lib/navigation.ts:19`) es el menú del estudio:
  Clientes, Presupuestos, Facturas, Tarifas, Estudios de Mercado. A un cliente no se le enseña.
  Se añade un `PORTAL_NAV` corto y el layout elige según el rol.
- **Redirección por rol:** un `client` que aterrice en cualquier ruta de staff va a `/portal`. No es
  la defensa — la defensa es la puerta del back, que ya devuelve 403 — es que no se le enseñe una
  pantalla que sólo puede fallar.
- Cuidado conocido: una ruta nueva del front redirige a `/?returnTo` si no está exenta en
  `PUBLIC_PATHS`. `/portal` **no** es pública (requiere sesión), así que no se toca esa lista; lo
  que hay que revisar es que el guard de sesión no la trate como pública por error.

## F. Estrategia de test

El test que justifica el change es el negativo. Los demás confirman que no rompimos nada.

1. **Aislamiento (obligatorio, uno por endpoint).** Cliente de tenant A pide un recurso de tenant B
   ⇒ 404 y **cero filas** del otro tenant en la respuesta. No basta comprobar el status: se asserta
   el cuerpo.
2. **La puerta.** `isClientAllowed` puro: `GET /api/portal/*` pasa; `GET /api/agents`,
   `GET /api/clientes`, `POST /api/portal/x` y una ruta inventada no pasan. Este test es el que
   protege a los routers futuros.
3. **Regresión de staff.** `admin`/`editor`/`viewer` con `tenantId` NULL: la puerta llama a `next()`
   y el acceso es el de hoy, incluido `/api/portal` si alguna vez lo pidieran.
4. **`client` sin `tenantId`** ⇒ 403, y no una consulta sin filtro.
5. **Coherencia de cupo.** El número que devuelve `/api/portal/me` es el que aplica
   `checkClientBalance`: mismo `resolveTokenQuota`, mismo periodo.
6. **`isTest` y estados.** Conversaciones de consola no aparecen; agentes `draft`/`archived` no se
   listan.
