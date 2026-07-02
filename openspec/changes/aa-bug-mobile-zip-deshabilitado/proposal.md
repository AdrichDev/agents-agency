# Proposal — Botón "Descargar mobile.zip" deshabilitado sin feedback (aa-bug-mobile-zip-deshabilitado)

**Nivel Gru: 2 — Medio.** Un componente front + posible dependencia de endpoint backend.

## Contexto
El diagnóstico previo (disabled hardcoded / placeholder) es **falso**: `front/components/landing/MobilePanel.tsx` está implementado de verdad. Android/iOS (líneas 93-107) sí llaman `generate()` (línea 19) → `POST /api/landing/${projectId}/mobile` vía `api()`. Expo/Flutter (líneas 69-88) solo setean `stack`, lo cual es correcto para ese flujo. El disabled del botón "Descargar mobile.zip" (línea 130) depende de `hasMobile = Object.keys(mobileFiles).length>0` (línea 60); `mobileFiles` se puebla en `front/hooks/useLandingBuilder.ts:160-164` tras respuesta OK del backend.

Causa real probable: el endpoint backend `/api/landing/:id/mobile` no existe o falla → `generate()` cae en el bloque `catch` (línea 33) → `mobileFiles` nunca se puebla → el botón queda deshabilitado indefinidamente, sin que el usuario sepa por qué.

## Intención
Que el usuario entienda por qué el botón está deshabilitado (falta generar primero, o falló la generación) en vez de ver un botón muerto sin explicación.

## Alcance
- **T0 (dependencia backend, fuera de este repo front)**: confirmar si el endpoint `/api/landing/:id/mobile` existe y responde correctamente. Si no existe o falla, es un bloqueante backend que condiciona si el fix de fondo es posible desde el front.
- **Front — mejora de feedback** (MEJORA#3): añadir tooltip en el botón deshabilitado explicando la condición ("Genera la app primero"), y mostrar el error real del `catch` de `generate()` al usuario en vez de fallar en silencio.

## Fuera de alcance
- Implementar o arreglar el endpoint backend `/api/landing/:id/mobile` en sí (vive fuera de este repo front; se marca como dependencia).

## Open questions (resolver en T0)
- ¿El endpoint `/api/landing/:id/mobile` existe en el backend `:4000`? ¿Responde 200 con los archivos esperados o falla? Sin esta confirmación no se puede saber si el fix de fondo es alcanzable solo con front.

## Riesgos
- Si el endpoint backend no existe, este change queda parcialmente bloqueado: solo se puede mejorar el feedback de error, no el flujo funcional completo. Marcar la dependencia con claridad para no prometer un fix que no depende de este repo.
