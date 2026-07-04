# Propuesta ? Navegaci?n lateral agrupada

**Nivel Gru: 2 ? Media.** Reorganizaci?n de IA de navegaci?n con dependencia funcional de `Facturas`.
**Estado: SPEC (aprobado el alcance, pendiente implementaci?n).**

## Contexto
El sidebar actual de `agents-agency` expone navegaci?n plana. El usuario pidi? alinearlo con la
l?gica visual de `creador_CRM`, agrupando m?dulos por dominios funcionales y colocando `Facturas`
dentro de `Facturaci?n` una vez exista el cambio previo.

## Intenci?n
1. Agrupar el sidebar en bloques funcionales claros.
2. Renombrar `Panel de control` como `Dashboard` dentro del grupo superior.
3. Mantener intactos estado activo, insignias y modo colapsado.
4. Reflejar el orden funcional pedido por negocio.

## Decisiones
- El grupo superior se mostrar? como `Nombre grupal` e incluir? `Dashboard`, `Mi cuenta` y `Configuraci?n`.
- `Pedidos` contendr? `Nuevo Agente`, `Marketplace` y `Landing Builder`.
- `Clientes / Lead` contendr? `Clientes` y `Contactos`.
- `Facturaci?n` contendr? `Presupuestos` y `Facturas`.
- `Data` contendr? `Estad?sticas`.

## Alcance
- Nueva estructura de navegaci?n agrupada.
- Renderizado de grupos en sidebar expandido y compatibilidad con sidebar colapsado.
- Conservaci?n del comportamiento actual de rutas activas e insignias.

## Fuera de alcance
- Cambios de permisos, ACL o nuevas rutas de negocio.
- Redise?o visual completo del componente sidebar.
- Cambios en la navegaci?n interna de `creador_CRM`.

## Riesgos
- P?rdida del resaltado activo al introducir jerarqu?a.
- Insignias invisibles en modo colapsado.
- Exponer `Facturas` antes de que exista la ruta del cambio previo.

## Dependencias
Depende de `aa-facturas-desde-presupuestos-aceptados` y debe completarse antes de `crm-paridad-facturas-pedidos-aa`.

