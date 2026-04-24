-- Migration 003: Agregar columna "orden" a planeacion.rutas_siesa
-- Ejecutar contra: kos_apps (Azure SQL Server)

-- 1. Agregar columna si no existe (nullable para no fallar en tablas pobladas)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'planeacion'
      AND TABLE_NAME   = 'rutas_siesa'
      AND COLUMN_NAME  = 'orden'
)
BEGIN
    EXEC('ALTER TABLE planeacion.rutas_siesa ADD orden INT NULL');
END;

-- 2. Backfill de NULLs con 0
UPDATE planeacion.rutas_siesa SET orden = 0 WHERE orden IS NULL;
