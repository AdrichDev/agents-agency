# Diseño: Navegación lateral agrupada en Agents Agency

## Enfoque técnico

Transformar la navegación plana actual en una navegación agrupada, manteniendo el comportamiento existente de la barra lateral y usando una estructura de configuración clara y extensible.

## Decisiones de arquitectura

| Decisión | Elección | Alternativas consideradas | Motivo |
|----------|----------|---------------------------|--------|
| Fuente de navegación | Configuración agrupada en `front/lib/navigation.ts` | Deducir grupos directamente en el componente | Mantiene la estructura declarativa y fácil de probar. |
| Compatibilidad | Mantener derivación plana si otros consumidores la necesitan | Romper el contrato actual | Reduce regresiones en componentes no revisados. |
| Colapso | Conservar la lógica actual y adaptar solo la representación | Rehacer la barra lateral completa | Minimiza la superficie de cambio. |
| Dependencia con facturas | Añadir `Facturas` solo sobre la nueva ruta del cambio 1 | Crear un placeholder temporal | Evita navegación hacia una pantalla no implementada. |

## Flujo de datos

    configuración de navegación agrupada ──> Sidebar.tsx
                    │                         │
                    │                         ├── representación de grupos e items
                    │                         ├── cálculo de estado activo
                    │                         └── insignias y modo colapsado
                    └── posible derivación plana para compatibilidad

## Cambios de archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `agents-agency/front/lib/navigation.ts` | Modificar | Definir grupos e items en el orden requerido. |
| `agents-agency/front/components/Sidebar.tsx` | Modificar | Representar grupos sin perder insignias, rutas activas y colapso. |
| `agents-agency/front/components/SidebarNavItem.tsx` | Revisar | Confirmar que soporta insignias y estado activo sin cambios adicionales. |

## Interfaces y contratos

- La configuración de navegación DEBE exponer grupos y, si hace falta, una vista plana derivada para compatibilidad.
- El contrato visual de `SidebarNavItem` se mantiene: `href`, `label`, `icon`, `active`, `collapsed`, `badge`.

## Estrategia de pruebas

| Capa | Qué probar | Enfoque |
|------|------------|---------|
| Configuración | Orden y composición de grupos | Pruebas unitarias. |
| UI | Representación expandida y colapsada | Pruebas de componente. |
| Navegación | Estado activo por ruta | Pruebas con rutas representativas. |
| Regresión | Insignia de contactos | Prueba específica sobre `/contactos`. |

## Migración y despliegue

No requiere migración de datos. Se despliega después de la ruta de `Facturas` para evitar enlaces huérfanos.

## Preguntas abiertas

- [ ] Confirmar si `Nombre grupal` es literal definitivo o si luego se sustituirá por un nombre de negocio configurable.

