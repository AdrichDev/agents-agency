# Propuesta — Lead Message & CRM Actions

> Estado: **in-progress** · Nivel estimado: **3** (Large)

## Intención

Cinco mejoras sobre el flujo de captación y gestión de contactos:

1. **Respuesta rápida al lead**: el email de aviso al admin debe incluir un botón
   "Responder al lead" (mailto) con destinatario = email del lead y un cuerpo de
   mensaje predefinido (plantilla). El admin revisa y envía.
2. **Mensaje voluntario en la landing**: el formulario de captación añade un
   textarea opcional para que el visitante deje un comentario/petición. Se
   persiste.
3. **Persistencia del mensaje**: nueva columna `LandingLead.message` y
   `ProspectContact.peticion` (el mensaje se hereda al crear el contacto).
4. **Petición en la tabla CRM**: en "Posibles contactos", columna con botón
   "Petición" → abre modal con el texto + botón X de cierre que gira 90° a la
   derecha en hover.
5. **Añadir a cliente (bulk)**: botón en la cabecera de la tabla "Añadir a
   cliente" → activa modo selección (checkbox por fila), el botón se reemplaza
   por Aceptar/Cancelar; Aceptar abre modal de confirmación listando los nombres
   seleccionados y, al confirmar, convierte los contactos en clientes.

Extra: **el estado `contactado` por defecto es siempre "no"** para todo nuevo
lead o prospecto (antes el prospecto entraba como `nc`).

**Éxito**: lead deja mensaje → se guarda → admin lo ve en la tabla y en el email,
puede responder con un clic, y puede convertir contactos seleccionados en clientes.

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/prisma/schema.prisma` | Modificado | `LandingLead.message`, `ProspectContact.peticion` |
| `back/prisma/migrate-lead-message-peticion.sql` | Nuevo | Columnas aditivas |
| `back/src/routes/public.ts` | Modificado | Acepta y persiste `message` |
| `back/src/lib/notifications.ts` | Modificado | `message` en payload + `peticion` en contacto |
| `back/src/routes/contacts.ts` | Modificado | `peticion` en schemas/handlers, default `no`, endpoint bulk convert-to-clients |
| `back/n8n/nuevo-lead-workflow.json` | Modificado | Fila `message` + botón mailto "Responder al lead" |
| `front/components/landing/LeadForm.tsx` | Modificado | Textarea opcional |
| `front/app/contactos/page.tsx` | Modificado | Columna Petición + modal, modo selección + convertir a clientes |

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Workflow n8n ya importado en local no se actualiza solo | Alta | Re-importar JSON o editar nodo email manualmente |
| Conversión a cliente duplica clientes | Media | Marcar contacto con `clientId` tras convertir; idempotencia por revisión del admin |
| Cambio de default `contactado` rompe tests | Alta | Actualizar `contacts.test.ts` |

## Criterios de éxito

- [ ] Lead con mensaje → `LandingLead.message` y `ProspectContact.peticion` poblados.
- [ ] Email admin muestra el mensaje y un botón "Responder al lead" funcional.
- [ ] Textarea opcional en la landing; sin mensaje no rompe el envío.
- [ ] Botón "Petición" abre modal; X gira 90° en hover.
- [ ] "Añadir a cliente" activa selección, confirma y crea clientes.
- [ ] Todo nuevo contacto entra con `contactado = "no"`.
- [ ] `vitest` y `tsc --noEmit` verdes.
