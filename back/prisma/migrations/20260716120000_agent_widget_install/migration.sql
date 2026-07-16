-- aa-agent-backend-foundation F7 (T7.2)
-- Migracion ADITIVA: estado de instalacion del widget embebido (auto-verificacion
-- via ping). `widget.js` hace un POST best-effort a /api/widget/ping al cargar; el
-- backend sella `widget_instalado_en` en el primer ping y `widget_visto_en` en cada
-- carga. NO altera ni borra columnas existentes; ambas columnas son nullable (los
-- agentes existentes quedan como "pendiente de instalacion" hasta el primer ping).

-- AlterTable
ALTER TABLE "agente" ADD COLUMN "widget_instalado_en" TIMESTAMP(3);
ALTER TABLE "agente" ADD COLUMN "widget_visto_en" TIMESTAMP(3);
