# Spec — Content Security Policy (Report-Only)

## Requirement: Cabecera CSP Report-Only en el frontend

El frontend DEBE enviar `Content-Security-Policy-Report-Only` en todas las rutas,
con una política que restrinja `default-src` a `'self'`, prohíba el framing
(`frame-ancestors 'none'`) y `object-src 'none'`, y permita explícitamente el
widget (`http://localhost:4000`) en `script-src`/`connect-src`. Al ser
Report-Only, NO DEBE bloquear ningún recurso.

### Scenario: Cabecera presente y no bloqueante
- **WHEN** el navegador solicita cualquier ruta del frontend
- **THEN** la respuesta incluye `Content-Security-Policy-Report-Only` con la política
- **AND** la app carga y funciona con normalidad (no se bloquea nada)

### Scenario: Promoción a enforcing (futuro)
- **WHEN** se observe que no hay violaciones legítimas
- **THEN** se podrá cambiar a `Content-Security-Policy` (enforcing) con nonces
  en un change posterior (requiere verificación en navegador)
