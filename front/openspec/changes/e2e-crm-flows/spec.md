# Spec — E2E CRM Flows

## Requirement: E2E de la tabla de contactos
Existen E2E que validan, con el backend mockeado, los flujos de la página de
posibles contactos.

### Scenario: Render y orden
- **WHEN** se carga `/contactos` con contactos mockeados
- **THEN** la tabla muestra las filas
- **AND** al pulsar la cabecera "Nombre" se reordena (aparece flecha)

### Scenario: Paginación 10/página
- **WHEN** hay >10 contactos
- **THEN** se muestran 10 y "Página 1 de N"; "Siguiente" avanza de página

### Scenario: Modal de información
- **WHEN** se pulsa "Ver información" de una fila
- **THEN** aparece el modal "Información del contacto" con los datos (incl. Petición)

### Scenario: Borrado con confirmación
- **WHEN** se pulsa "Eliminar" y se confirma en el diálogo
- **THEN** la fila desaparece

### Scenario: Convertir a cliente
- **WHEN** se entra en modo selección, se marca un contacto y se acepta
- **THEN** se muestra el modal de confirmación y, al aceptar, se llama a convert-to-clients

## Requirement: E2E de la tabla de clientes
### Scenario: Alta y acciones
- **WHEN** se carga `/clientes` y se pulsa "Nuevo cliente"
- **THEN** se abre el formulario; las filas tienen acciones icono editar/eliminar
