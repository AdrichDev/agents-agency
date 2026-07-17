-- aa-agente-consola-pruebas F1 (T1.2) / Nivel 2
-- Migracion ADITIVA: marca las conversaciones creadas desde la consola de pruebas
-- del operador. NOT NULL con DEFAULT false: las filas existentes quedan false
-- (regresion cero) y el metering (deductTokens) sigue contando en modo test; solo
-- se excluyen de los listados/analitica que ve el cliente (T1.3).

ALTER TABLE "conversacion" ADD COLUMN "es_prueba" BOOLEAN NOT NULL DEFAULT false;
