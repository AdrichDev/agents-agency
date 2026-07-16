-- aa-skills-executable-contract F1: contrato explícito skill → facultad.
-- Añade skill.tools_provider (clave de TOOLS_BY_PROVIDER o NULL = informativa)
-- y hace el backfill ÚNICO aplicando la heurística legada que se elimina del
-- código (name-override primero, luego mapa de `uso`), para que el catálogo
-- existente conserve exactamente las facultades que tenía.
-- Idempotente: ADD COLUMN IF NOT EXISTS + updates condicionados a NULL.

ALTER TABLE skill ADD COLUMN IF NOT EXISTS tools_provider TEXT;

-- Pase 1: overrides por substring del nombre (ganaban sobre `uso`).
UPDATE skill SET tools_provider = 'calendar'
  WHERE tools_provider IS NULL
    AND (lower(nombre) LIKE '%calendar%' OR lower(nombre) LIKE '%calendario%');
UPDATE skill SET tools_provider = 'gmail'
  WHERE tools_provider IS NULL AND lower(nombre) LIKE '%gmail%';
UPDATE skill SET tools_provider = 'slack'
  WHERE tools_provider IS NULL AND lower(nombre) LIKE '%slack%';
UPDATE skill SET tools_provider = 'notion'
  WHERE tools_provider IS NULL AND lower(nombre) LIKE '%notion%';
UPDATE skill SET tools_provider = 'ecommerce'
  WHERE tools_provider IS NULL
    AND (lower(nombre) LIKE '%pedido%' OR lower(nombre) LIKE '%order%');

-- Pase 2: mapa Skill.uso → provider (solo donde el pase 1 no decidió).
UPDATE skill SET tools_provider = 'calendar'
  WHERE tools_provider IS NULL AND upper(uso) IN ('CALENDARIO', 'CALENDAR');
UPDATE skill SET tools_provider = 'gmail'
  WHERE tools_provider IS NULL AND upper(uso) IN ('EMAIL', 'GMAIL');
UPDATE skill SET tools_provider = 'slack'
  WHERE tools_provider IS NULL AND upper(uso) = 'SLACK';
UPDATE skill SET tools_provider = 'notion'
  WHERE tools_provider IS NULL AND upper(uso) = 'NOTION';
UPDATE skill SET tools_provider = 'ecommerce'
  WHERE tools_provider IS NULL AND upper(uso) IN ('ECOMMERCE', 'ORDER_STATUS');
