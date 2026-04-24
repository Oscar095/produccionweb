-- Migration 002: Crear tabla planeacion.rutas_siesa y relacionar con dbo.maquinas
-- Ejecutar contra: kos_apps (Azure SQL Server)

-- 1. Crear tabla maestra de rutas SIESA
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'planeacion' AND TABLE_NAME = 'rutas_siesa'
)
BEGIN
    CREATE TABLE planeacion.rutas_siesa (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        nombre_ruta NVARCHAR(200) NOT NULL,
        descripcion NVARCHAR(500) NULL,
        activo      BIT NOT NULL DEFAULT 1,
        created_at  DATETIME2 DEFAULT GETUTCDATE()
    );
END;

-- 2. Poblar con valores distintos existentes en dbo.maquinas.rutas_siesa
-- Nota: rutas_siesa es TEXT, requiere CAST a NVARCHAR para usar LTRIM/RTRIM
INSERT INTO planeacion.rutas_siesa (nombre_ruta)
SELECT DISTINCT LTRIM(RTRIM(CAST(rutas_siesa AS NVARCHAR(200))))
FROM dbo.maquinas
WHERE rutas_siesa IS NOT NULL
  AND LTRIM(RTRIM(CAST(rutas_siesa AS NVARCHAR(200)))) <> ''
  AND LTRIM(RTRIM(CAST(rutas_siesa AS NVARCHAR(200)))) NOT IN (
      SELECT nombre_ruta FROM planeacion.rutas_siesa
  );

-- 3. Agregar columna FK a dbo.maquinas (solo si no existe)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'maquinas' AND COLUMN_NAME = 'rutas_siesa_id'
)
BEGIN
    ALTER TABLE dbo.maquinas
        ADD rutas_siesa_id INT NULL
            CONSTRAINT FK_maquinas_rutas_siesa
            FOREIGN KEY REFERENCES planeacion.rutas_siesa(id);
END;

-- 4. Backfill: relacionar texto existente con IDs recién creados
UPDATE m
SET m.rutas_siesa_id = r.id
FROM dbo.maquinas m
JOIN planeacion.rutas_siesa r
    ON LTRIM(RTRIM(CAST(m.rutas_siesa AS NVARCHAR(200)))) = r.nombre_ruta
WHERE m.rutas_siesa IS NOT NULL
  AND m.rutas_siesa_id IS NULL;
