# Tareas: Navegación lateral agrupada

## Previsión de carga de revisión

| Campo | Valor |
|-------|-------|
| Líneas estimadas modificadas | 180-320 |
| Riesgo de superar 400 líneas | Medio |
| PRs encadenadas recomendadas | No |
| División sugerida | Una sola PR después de que exista Facturas |
| Estrategia de entrega | consultar-ante-riesgo |
| Estrategia de cadena | pendiente |

Decisión necesaria antes de aplicar: No
PRs encadenadas recomendadas: No
Estrategia de cadena: pendiente
Riesgo de superar 400 líneas: Medio

### Unidades de trabajo sugeridas

| Unidad | Objetivo | PR probable | Notas |
|--------|----------|-------------|-------|
| 1 | Configuración y representación de navegación agrupada | PR 1 | Depende del cambio 1. |

## Fase 1: Configuración

- [x] 1.1 Convertir `front/lib/navigation.ts` a `NAV_GROUPS` con los grupos solicitados.
- [x] 1.2 Mantener `NAV_ITEMS` plano derivado si hay consumidores existentes.
- [x] 1.3 Agregar item `Facturas` bajo `Facturacion` apuntando a `/facturas`.

## Fase 2: Representación de la barra lateral

- [x] 2.1 Adaptar `front/components/Sidebar.tsx` para iterar grupos e items.
- [x] 2.2 Preservar la lógica de estado activo para las rutas actuales.
- [x] 2.3 Preservar insignias y comportamiento visual en modo colapsado.

## Fase 3: Pruebas

- [x] 3.1 Probar el orden exacto de grupos e items.
- [x] 3.2 Probar el nombre visible `Dashboard` sustituyendo `Panel de control`.
- [x] 3.3 Probar estado activo, insignias y colapso con rutas representativas.

