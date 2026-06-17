# Design — Dead Code Cleanup

## Decisiones

### ADR-1 — Cherry-pick manual, no auto-borrado de knip
knip tiene falsos positivos conocidos en este repo (assets servidos estáticos,
scripts de tooling, deps usadas en runtime por string, exports de tipos usados
internamente). Solo se eliminan ítems verificados a mano como sin uso.

### ADR-2 — knip.json con entry points
Declarar `entry` (server, scripts, tests) y `ignore` (generated, public) +
`ignoreDependencies` (prisma, pino-pretty) hace la salida de knip accionable.

### ADR-3 — knip en CI no bloqueante
Como `npm audit`: `continue-on-error: true`, alcance `--include files,dependencies`
(lo más accionable, menos ruido). Promover a bloqueante es decisión posterior.

## Rollback
Aditivo/borrados reversibles. Rollback = revertir el commit.
