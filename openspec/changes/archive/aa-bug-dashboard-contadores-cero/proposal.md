# Proposal — Contadores del dashboard en 0 mientras cargan (aa-bug-dashboard-contadores-cero)

**Nivel Gru: 1 — Pequeño.** Un solo archivo, mejora de UX, cambio reversible.

## Contexto
`app/dashboard/page.tsx` declara `const [agents, setAgents] = useState<AgentRow[]|null>(null)`. Los contadores, como `const totalAgents = agents?.length || 0` (línea 57), caen a `0` mientras `agents` es `null` (antes de que resuelva el `useEffect` de carga, líneas 51-55). No existe ningún estado `isLoading` en el componente — no es una variable sin usar, directamente no existe. El resultado visible es que el usuario ve "0" en todos los contadores durante el instante de carga, lo cual puede leerse como "no tengo agentes/datos" en vez de "todavía está cargando".

## Intención
Que el usuario vea un estado de carga (skeleton) en los contadores mientras `agents === null`, en vez de un "0" que puede confundirse con dato real.

## Alcance
- `app/dashboard/page.tsx`: añadir un estado de carga explícito (usar directamente `agents === null` como condición, sin necesidad de un state adicional) y mostrar un skeleton/placeholder en los contadores mientras esa condición es verdadera (MEJORA#1).
- Los cálculos como `totalAgents` deben distinguir "cargando" de "cero real" en el render, no solo en el valor numérico.

## Fuera de alcance
- Cambios en el endpoint o en la forma en que se cargan los agentes.
- Rediseño visual del dashboard más allá del feedback de carga.

## Open questions
- ¿El skeleton debe aplicarse a todos los contadores del dashboard o solo a `totalAgents`? Verificar si hay otros contadores con el mismo patrón `x?.length || 0` en el mismo archivo antes de decidir el alcance exacto del skeleton.

## Riesgos
- Ninguno relevante. Cambio de UX local y reversible, sin impacto en datos ni lógica de negocio.
