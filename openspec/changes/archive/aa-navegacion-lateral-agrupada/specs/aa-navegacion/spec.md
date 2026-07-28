# Spec ? Navegaci?n lateral agrupada

## UC-1 ? Agrupaci?n funcional del sidebar
**GIVEN** que el usuario abre la aplicaci?n con el sidebar expandido
**WHEN** la navegaci?n se renderiza
**THEN** el sistema DEBE mostrar grupos funcionales en el orden definido por negocio.

- AC-1.1 `Nombre grupal` DEBE contener `Dashboard`, `Mi cuenta` y `Configuraci?n`.
- AC-1.2 `Pedidos` DEBE contener `Nuevo Agente`, `Marketplace` y `Landing Builder`.
- AC-1.3 `Clientes / Lead` DEBE contener `Clientes` y `Contactos`.
- AC-1.4 `Facturaci?n` DEBE contener `Presupuestos` y `Facturas`.
- AC-1.5 `Data` DEBE contener `Estad?sticas`.

## UC-2 ? Conservaci?n de ruta activa
**GIVEN** que existe una ruta activa dentro de la navegaci?n
**WHEN** el sidebar se representa en la nueva jerarqu?a
**THEN** el item correspondiente DEBE seguir marcado como activo.

- AC-2.1 El grupo no DEBE romper la detecci?n de ruta actual.
- AC-2.2 `Facturas` DEBE apuntar a la ruta creada por el cambio previo.

## UC-3 ? Compatibilidad con colapso e insignias
**GIVEN** un sidebar colapsado con items activos o con badge
**WHEN** el usuario interact?a con la navegaci?n
**THEN** el sistema DEBER?A mantener la se?al visual existente sin ocultar informaci?n cr?tica.

- AC-3.1 Las insignias deben seguir visibles o representadas seg?n el patr?n actual.
- AC-3.2 El cambio NO DEBE degradar la usabilidad del modo colapsado.

## UC-4 ? Terminolog?a visible actualizada
**GIVEN** que el usuario revisa los nombres visibles del men?
**WHEN** observa el primer grupo
**THEN** el sistema DEBE mostrar `Dashboard` donde antes se mostraba `Panel de control`.

- AC-4.1 El resto de nombres visibles DEBEN respetar exactamente la terminolog?a pedida por negocio.

