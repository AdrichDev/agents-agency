# Proposal — SetupWizard no cambia de tab si ya estaba abierto (aa-bug-modal-qr-tab)

**Nivel Gru: 1 — Pequeño.** Un solo componente, cambio local y reversible.

## Contexto
`front/components/landing/SetupWizard.tsx:58-60` inicializa `const [step, setStep] = useState(initialStep)` sin ningún `useEffect` que resincronice `step` cuando cambia el prop `initialStep`. El modal se monta condicionalmente en `front/app/landing-builder/[id]/page.tsx:256` (`{showWizard && <SetupWizard .../>}`). `openWizard(step)` (`front/hooks/useLandingBuilder.ts:142-145`) hace `setWizardStep` + `setShowWizard(true)`. Si el modal **ya estaba abierto** (p. ej. se abrió con "Incluir Bot") y luego se pulsa "QR" (`front/app/landing-builder/[id]/page.tsx:126`), no hay remount del componente → el `step` interno de `SetupWizard` no se actualiza → el modal queda en el tab previo. Solo funciona si hay un remount limpio o si se navega con "Siguiente" dentro del propio wizard.

## Intención
Que abrir el wizard con un `step` distinto mientras ya está abierto actualice el tab mostrado, sin depender de cerrar y reabrir el modal.

## Alcance
- `front/components/landing/SetupWizard.tsx`: añadir `useEffect(() => setStep(initialStep), [initialStep])` para resincronizar el estado interno con el prop; o alternativamente forzar remount pasando `key={initialStep}` desde el punto de montaje en `app/landing-builder/[id]/page.tsx:256`.

## Fuera de alcance
- Rediseño del flujo de pasos del wizard.

## Open questions
- ¿`useEffect` de resync o `key` de remount? Ambos son válidos; `useEffect` preserva estado interno no relacionado con `step` si lo hubiera, `key` es más simple pero resetea todo el componente. Elegir según si `SetupWizard` mantiene otro estado interno relevante entre steps.

## Riesgos
- Ninguno relevante. Cambio local, reversible, no toca datos ni sesión.
