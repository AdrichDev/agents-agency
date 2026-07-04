# Validaci?n ? aa-navegacion-lateral-agrupada

Historia: como usuario de Agents Agency quiero ver la navegaci?n agrupada por ?reas funcionales,
para entender mejor d?nde trabajo pedidos, clientes, facturaci?n y datos.

## Criterios de aceptaci?n (AC)
- **AC1:** el sidebar muestra los grupos en el orden solicitado por negocio.
- **AC2:** `Nombre grupal` contiene `Dashboard`, `Mi cuenta` y `Configuraci?n`.
- **AC3:** `Pedidos` contiene `Nuevo Agente`, `Marketplace` y `Landing Builder`.
- **AC4:** `Clientes / Lead` contiene `Clientes` y `Contactos`.
- **AC5:** `Facturaci?n` contiene `Presupuestos` y `Facturas`.
- **AC6:** `Data` contiene `Estad?sticas`.
- **AC7:** el cambio preserva estado activo, insignias y comportamiento colapsado.

## Por tarea (Dado-Cuando-Entonces + test)
- **A.1-A.2 modelo de navegaci?n** ? **DADO** la configuraci?n del sidebar, **CUANDO** se define la nueva estructura, **ENTONCES** los grupos y sus items quedan ordenados seg?n la especificaci?n. Test: config/navigation unit test.
- **B.1-B.3 render expandido** ? **DADO** el sidebar expandido, **CUANDO** se renderiza, **ENTONCES** aparecen t?tulos de grupo e items con los nombres visibles pedidos. Test: render/UI.
- **B.4 estado activo** ? **DADO** una ruta activa, **CUANDO** el usuario navega, **ENTONCES** el item correspondiente sigue marcado aunque pertenezca a un grupo. Test: routing/UI regression.
- **B.5 colapso e insignias** ? **DADO** el sidebar colapsado, **CUANDO** existen items activos o con badge, **ENTONCES** la se?al visual se conserva sin perder informaci?n esencial. Test: collapsed sidebar snapshot.

> Regla del repo: una tarea est? DONE solo cuando su test est? verde. Sin spec, no hay implementaci?n v?lida.

