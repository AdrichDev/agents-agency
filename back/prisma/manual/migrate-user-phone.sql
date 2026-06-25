-- aa-perfil-editable: teléfono opcional para el usuario del SaaS.
-- Aditiva y reversible. Coexiste con todas las filas existentes (NULL por defecto).
ALTER TABLE aa.usuario ADD COLUMN IF NOT EXISTS telefono text;
