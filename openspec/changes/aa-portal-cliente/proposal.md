# aa-portal-cliente (H5 · P2.1)

## Intención

Que el cliente que ya paga un agente pueda entrar y verlo **sin que nadie del estudio le pase
capturas**: su agente, sus conversaciones y cuánto le queda de cupo este periodo. Sólo lectura.

Es la capa 7 del eje (`aa-agentes-entrega-monetizacion`, design.md:20): *"¿El cliente se sirve solo
y paga?"*. H5 resuelve la mitad de "se sirve solo". H6 resuelve "paga".

## El problema real (medido, no supuesto)

AA hoy es single-tenant por diseño explícito y por código:

| Hecho | Evidencia |
|---|---|
| `User` no tiene `tenantId` | `back/prisma/schema.prisma:17-28` |
| Cualquier autenticado entra a todo | `back/src/lib/auth.ts:10` — *"AA is single-tenant: all authenticated users with a matching aa.User are admitted"* |
| `requireRole` existe pero **se usa 1 vez** | `back/src/lib/auth.ts:107` → único call-site `back/src/routes/config.ts:88` |
| El resto de `/api/*` no comprueba rol | ~25 routers registrados en `back/src/index.ts` |

Por eso **la premisa del design del eje es insuficiente**. Dice *"vistas de sólo lectura …
reutilizando `requireRole()`"* (design.md:182-184). Reutilizarlo tal cual significa añadir el
middleware a ~25 routers y a todos los que se escriban después. El día que alguien añada un router
y se olvide, un cliente lee los datos de otro cliente. Un fallo de aislamiento no se descubre con
un test que no se escribió: se descubre cuando el cliente lo cuenta.

## Alcance

**Dentro:**

1. Rol `client` en `User.role` y `User.tenantId` (nullable) con FK a `tenant`.
2. **Puerta deny-by-default para `client`**: middleware tras la resolución de sesión que, si el rol
   es `client`, sólo deja pasar una allowlist explícita de rutas de portal. Todo lo demás, 403.
3. Endpoints de portal, sólo lectura, con el `tenantId` tomado **de la sesión** y nunca del
   request: sus agentes, sus conversaciones, su consumo y su plan.
4. Vistas de portal en el front, con navegación propia (la de staff no se le renderiza).
5. Test negativo de aislamiento entre tenants (lo exige el spec del eje, design.md:184).

**Fuera:**

- Checkout, cobro, cambio de plan → H6. El portal enseña el plan; no lo vende.
- Escritura de cualquier tipo desde el portal (editar el agente, subir conocimiento, borrar
  conversaciones). Sólo lectura, y así queda declarado.
- Invitar usuarios cliente desde la UI de staff. La creación del `User` con rol `client` se hace
  por endpoint de staff; la pantalla es deuda declarada, no parte de H5.
- Unificar los dos catálogos de precios duplicados (ver Riesgos).

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **Fuga entre tenants.** El peor fallo posible de este change. | `tenantId` sólo de la sesión; deny-by-default; test negativo obligatorio por endpoint; recurso de otro tenant ⇒ **404, no 403** (403 confirma que existe). |
| R2 | Romper el acceso del staff actual. `tenantId` NULL debe seguir significando "ve todo". | Migración aditiva y nullable; test de que un `admin` con `tenantId` NULL conserva el acceso exacto de hoy. |
| R3 | Un `client` sin `tenantId` sería un usuario con rol de cliente y acceso de nadie — o de todos, según cómo se lea el código. | Invariante: `role = 'client'` ⇒ `tenantId NOT NULL`, comprobado en la creación y en la puerta (si falta, 403, nunca "pasa"). |
| R4 | El portal enseña un precio distinto del que se cobra. | El portal **no guarda importes**. Enseña el nombre del plan y, si hay que enseñar la tarifa, la lee del catálogo (`front/components/presupuestos/types.ts:20`) cruzando `Plan.codigo` con el `id` del servicio. Una sola lista de tarifas. |
| R5 | Deuda encontrada, no creada por este change: el catálogo de precios está **duplicado a mano** en `front/components/presupuestos/types.ts:20` y `back/src/lib/service-catalog.ts:14`, y la copia del back **no tiene el campo `tokens`**. | Fuera de alcance, registrado. H5 sólo consume la copia del front (que es la completa). Unificar es su propio change. |

## Dependencias

- **Depende de:** H3 `aa-agente-ciclo-vida-publicacion` (el portal enseña estado del agente:
  `published` / `suspended`), H4 `aa-planes-y-cuotas` (el consumo se compara contra el cupo que
  resuelve `resolveTokenQuota`). Ambas cerradas.
- **Bloquea:** H6 `aa-stripe-suscripciones` (el checkout vive en el portal).
- **Migración esperada:** sí, aditiva (`usuario.tenant_id` + índice).

## Nivel y aprobación

**Nivel 4 (crítico):** auth/seguridad (3) + datos persistentes/migración (2) + 4+ ficheros (2) +
cruza back y front (2) = 9 puntos. Requiere **aprobación humana antes de codear** y revisión antes
de cualquier push.
