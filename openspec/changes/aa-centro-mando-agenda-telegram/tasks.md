# Tasks · Centro de Mando, Agenda y Telegram UI en Agents Agency

## Review Workload Forecast
| Field | Value |
|-------|-------|
| Estimated changed lines | 900-1500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 sidebar · PR2 agenda · PR3 detalle/maps · PR4 calendario · PR5 Telegram UI |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

## Phase 1: Navegación
- [ ] 1.1 Actualizar `agents-agency/front/lib/navigation.ts`: título `Centro de Mando`, grupo `Area de Trabajo`, item `/agenda`.
- [ ] 1.2 Ajustar `agents-agency/front/components/Sidebar.tsx` para usar estilo de títulos OperaOS.
- [ ] 1.3 Test de navegación para labels, orden y estado activo.

## Phase 2: Agenda full-screen
- [ ] 2.1 Crear `agents-agency/front/app/agenda/page.tsx` clonando la gramática visual de `AgendaWidget` de OperaOS.
- [ ] 2.2 Extraer/adaptar estilos de agenda full-screen sin romper el widget origen.
- [ ] 2.3 Conectar la vista a citas reales del tenant.

## Phase 3: Detalle y mapas
- [ ] 3.1 Crear/ajustar modal de detalle con cliente comercial, contacto, teléfono, dirección y datos actuales.
- [ ] 3.2 Añadir botón `📍 Ubicación` bajo anotaciones con estado activo/desactivado y URL Google Maps.
- [ ] 3.3 Tests de modal con/sin dirección.

## Phase 4: Calendario externo
- [ ] 4.1 Normalizar puerto calendario Google/Outlook-ready en back.
- [ ] 4.2 Cubrir create/update/delete de cita contra calendario conectado.
- [ ] 4.3 Tests contract con proveedor mock.

## Phase 5: Telegram UI
- [ ] 5.1 Crear vista/componentes de conversación Telegram en directo.
- [ ] 5.2 Añadir envío manual desde UI con registro idempotente.
- [ ] 5.3 Tests webhook-UI y UI-Telegram.
