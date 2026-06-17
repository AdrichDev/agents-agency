# Spec — Express Request Type Augmentation

## Requirement: Acceso tipado a campos de Request
Los campos añadidos a `Express.Request` en runtime (`user`, `rawBody`,
`validatedBody/Query/Params`) DEBEN estar declarados en una augmentación de tipos,
de modo que el código acceda a ellos sin `(req as any)`.

### Scenario: Tipos verdes
- **WHEN** se compila el backend
- **THEN** el acceso a `req.user`/`req.rawBody`/`req.validatedBody` es tipado
- **AND** `tsc --noEmit` y `vitest` (352) quedan verdes
