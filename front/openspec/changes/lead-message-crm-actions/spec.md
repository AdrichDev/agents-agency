# Spec — Lead Message & CRM Actions

## Requirement: Mensaje voluntario en la captación de leads

El formulario público de la landing DEBE ofrecer un campo de texto opcional para
que el visitante deje un comentario o petición. El backend DEBE persistirlo.

### Scenario: Lead envía formulario con mensaje
- **WHEN** un visitante rellena nombre, email, teléfono, acepta el consentimiento
  y escribe un comentario en el textarea
- **THEN** el lead se guarda con `LandingLead.message` poblado
- **AND** el `ProspectContact` autocreado hereda el texto en `peticion`

### Scenario: Lead envía formulario sin mensaje
- **WHEN** el visitante deja el textarea vacío
- **THEN** el lead se guarda con `message = null` y el envío no falla

## Requirement: Notificación con respuesta predefinida

El email de aviso al admin DEBE incluir el mensaje del lead (si existe) y un botón
"Responder al lead" que abra un `mailto:` al email del lead con un cuerpo de
mensaje predefinido.

### Scenario: Admin recibe aviso de nuevo lead
- **WHEN** llega un nuevo lead
- **THEN** el email al admin muestra nombre, email, teléfono, origen, fecha y el
  mensaje del lead
- **AND** incluye un botón "Responder al lead" con `mailto:{email}` y cuerpo
  plantilla prerredactado

## Requirement: Ver petición del contacto

La tabla "Posibles contactos" DEBE permitir ver el mensaje/petición de cada
contacto en un modal.

### Scenario: Abrir petición
- **WHEN** el admin pulsa el botón "Petición" de una fila con texto
- **THEN** se abre un modal con el texto completo
- **AND** el botón X de cierre gira 90° a la derecha al hacer hover

### Scenario: Contacto sin petición
- **WHEN** una fila no tiene petición
- **THEN** no se muestra botón accionable (o aparece deshabilitado/“—”)

## Requirement: Conversión masiva a clientes

La tabla DEBE permitir seleccionar varios contactos y convertirlos en clientes.

### Scenario: Activar modo selección
- **WHEN** el admin pulsa "Añadir a cliente" en la cabecera
- **THEN** aparece un checkbox por fila
- **AND** el botón "Añadir a cliente" se reemplaza por "Aceptar" y "Cancelar"

### Scenario: Confirmar conversión
- **WHEN** el admin selecciona contactos y pulsa "Aceptar"
- **THEN** se abre un modal "¿Estás de acuerdo con agregar a cliente los
  siguientes contactos?" con la lista de nombres seleccionados
- **AND** al confirmar, cada contacto seleccionado se crea como `Client` y queda
  vinculado (`ProspectContact.clientId`)

### Scenario: Cancelar selección
- **WHEN** el admin pulsa "Cancelar"
- **THEN** se sale del modo selección sin cambios y vuelve el botón "Añadir a cliente"

## Requirement: Estado contactado por defecto

Todo nuevo lead o prospecto DEBE entrar con `contactado = "no"`.

### Scenario: Alta de prospecto
- **WHEN** se crea un contacto sin especificar `contactado`
- **THEN** `contactado` es `"no"` (tanto para `lead` como para `prospecto`)
