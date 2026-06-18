-- Avatar de widget en Supabase Storage: nueva columna que guarda la URL pública.
-- Aditiva y reversible. La columna legacy widget_avatar_base64 se conserva y coexiste.
ALTER TABLE aa.agente ADD COLUMN IF NOT EXISTS widget_avatar_url text;
