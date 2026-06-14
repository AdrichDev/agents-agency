# Design — Lead Message & CRM Actions

## Datos

- `LandingLead.message String?` — texto libre opcional (cap 2000 en zod).
- `ProspectContact.peticion String?` — heredado del lead al autocrearse, o nota
  manual desde el formulario CRM.
- Migración aditiva vía `prisma db push` + SQL idempotente
  (`ADD COLUMN IF NOT EXISTS`).

## Flujo de notificación (sin cambios estructurales)

`POST /api/public/leads` → `prisma.landingLead.create` →
`processNewLead({...,message})` → `createLeadContact` (peticion) +
`notifyLeadViaWebhook` (payload incluye `message`) → n8n.

El nodo email de n8n añade:
- Fila `message` en la tabla HTML (`{{ $json.body.message }}`).
- Botón mailto: `mailto:{{ $json.body.email }}?subject=...&body=<plantilla>`.

Nota operativa: el workflow ya está importado en n8n local; tras editar el JSON
hay que **re-importar** o editar el nodo email a mano.

## Conversión a clientes

Nuevo endpoint `POST /api/contacts/convert-to-clients` body `{ ids: string[] }`.

Por cada contacto:
1. Crear `Client` con `name`, `email`, `phone`, `sector`, `direccion` del contacto
   y `codCliente` secuencial (`nextClientCode` + `withCodeRetry`).
2. Vincular el contacto: `ProspectContact.clientId = client.id`.

Decisión: se mantiene el `ProspectContact` (no se borra) para conservar el
historial; el `clientId` marca que ya fue convertido. Códigos secuenciales se
generan dentro del bucle reusando `withCodeRetry` (volumen bajo, sin transacción
distribuida).

## UI tabla contactos

Estado local nuevo en `contactos/page.tsx`:
- `peticionModal: { open: boolean; text: string }`
- `selectionMode: boolean`
- `selectedIds: Set<string>`
- `confirmConvertOpen: boolean`

Columna "Petición": botón que abre `peticionModal`. Modal reusa `Modal`; el botón
X se implementa con `transition-transform hover:rotate-90`.

Modo selección: cabecera condicional — botón "Añadir a cliente" ↔ par
"Aceptar"/"Cancelar"; columna checkbox condicional al inicio de cada fila.

## Alternativas descartadas

- **Auto-respuesta al lead** (segundo nodo email): descartada por el usuario;
  prefiere control manual vía botón "Responder al lead".
- **Borrar el contacto al convertir**: descartado para conservar historial.
