-- ============================================================
-- KOS Xpress — Migración 001
-- Crea esquema planeacion.* con tablas nuevas para la plataforma.
-- NO modifica ninguna tabla existente de dbo.* (AppSheet sigue funcionando).
-- Ejecutar UNA SOLA VEZ en la base de datos kos_apps.
-- ============================================================

-- 1. Crear esquema separado
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'planeacion')
    EXEC('CREATE SCHEMA planeacion');
GO

-- 2. Tabla de usuarios del sistema KOS Xpress
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES
               WHERE TABLE_SCHEMA = 'planeacion' AND TABLE_NAME = 'usuarios')
BEGIN
    CREATE TABLE planeacion.usuarios (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        username      NVARCHAR(50)  NOT NULL UNIQUE,
        password_hash NVARCHAR(256) NOT NULL,
        nombre        NVARCHAR(100) NOT NULL,
        rol           NVARCHAR(20)  NOT NULL DEFAULT 'operador',
        -- roles: admin | supervisor | operador
        activo        BIT NOT NULL DEFAULT 1,
        created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT 'Tabla planeacion.usuarios creada';
END
GO

-- 3. Tabla de asignaciones (OP → máquina + fechas + prioridad)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES
               WHERE TABLE_SCHEMA = 'planeacion' AND TABLE_NAME = 'asignaciones')
BEGIN
    CREATE TABLE planeacion.asignaciones (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        op_docto          INT NOT NULL,           -- = dbo.op_numeros.docto
        maquina_id        INT NOT NULL,           -- FK a dbo.maquinas.Id
        fecha_inicio_plan DATETIME2 NOT NULL,
        fecha_fin_plan    DATETIME2 NOT NULL,
        prioridad         INT NOT NULL DEFAULT 100, -- menor = más urgente
        suspendida        BIT NOT NULL DEFAULT 0,
        motivo_suspension NVARCHAR(MAX) NULL,
        created_at        DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at        DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_asig_maquina  FOREIGN KEY (maquina_id)  REFERENCES dbo.maquinas(Id)
    );

    CREATE INDEX IX_asig_maquina      ON planeacion.asignaciones (maquina_id);
    CREATE INDEX IX_asig_op_docto     ON planeacion.asignaciones (op_docto);
    CREATE INDEX IX_asig_fechas       ON planeacion.asignaciones (fecha_inicio_plan, fecha_fin_plan);
    PRINT 'Tabla planeacion.asignaciones creada';
END
GO

-- 4. Tabla de paradas programadas (mantenimiento preventivo, etc.)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES
               WHERE TABLE_SCHEMA = 'planeacion' AND TABLE_NAME = 'paradas_programadas')
BEGIN
    CREATE TABLE planeacion.paradas_programadas (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        maquina_id  INT NOT NULL,
        inicio      DATETIME2 NOT NULL,
        fin         DATETIME2 NOT NULL,
        motivo      NVARCHAR(200) NOT NULL,
        tipo        NVARCHAR(20) NOT NULL DEFAULT 'preventivo',
        -- tipo: preventivo | correctivo | limpieza | otro
        created_by  INT NULL,
        created_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_parada_maquina  FOREIGN KEY (maquina_id)  REFERENCES dbo.maquinas(Id),
        CONSTRAINT FK_parada_usuario  FOREIGN KEY (created_by)  REFERENCES planeacion.usuarios(id)
    );

    CREATE INDEX IX_parada_maquina_rango ON planeacion.paradas_programadas (maquina_id, inicio, fin);
    PRINT 'Tabla planeacion.paradas_programadas creada';
END
GO

-- 5. Tabla de resúmenes semanales generados
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES
               WHERE TABLE_SCHEMA = 'planeacion' AND TABLE_NAME = 'resumen_semanal')
BEGIN
    CREATE TABLE planeacion.resumen_semanal (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        semana_inicio DATETIME2 NOT NULL,
        semana_fin    DATETIME2 NOT NULL,
        generado_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        generado_por  INT NULL,
        pdf_path      NVARCHAR(500) NULL,
        enviado       BIT NOT NULL DEFAULT 0,
        email_destino NVARCHAR(500) NULL,

        CONSTRAINT FK_resumen_usuario FOREIGN KEY (generado_por) REFERENCES planeacion.usuarios(id)
    );
    PRINT 'Tabla planeacion.resumen_semanal creada';
END
GO

-- 6. Índices adicionales sobre tablas EXISTENTES de dbo.* (sin ALTER TABLE)
-- Solo creados si no existen, mejoran performance del Gantt

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_solicitudes_maquina_fecha' AND object_id = OBJECT_ID('dbo.solicitudes_mantenimiento'))
    CREATE INDEX IX_solicitudes_maquina_fecha
        ON dbo.solicitudes_mantenimiento (row_maquina, fecha, fecha_solucion);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_registro_prod_maquina_fecha' AND object_id = OBJECT_ID('dbo.registro_produccion'))
    CREATE INDEX IX_registro_prod_maquina_fecha
        ON dbo.registro_produccion (maquina, fecha, numero_op);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_op_numeros_docto' AND object_id = OBJECT_ID('dbo.op_numeros'))
    CREATE INDEX IX_op_numeros_docto
        ON dbo.op_numeros (docto);
GO

-- 7. Usuario admin inicial (contraseña: admin123 — CAMBIAR EN PRODUCCIÓN)
-- El hash corresponde a bcrypt de 'admin123'
-- Para generar un nuevo hash: python -c "from passlib.context import CryptContext; c=CryptContext(schemes=['bcrypt']); print(c.hash('tu_password'))"
IF NOT EXISTS (SELECT * FROM planeacion.usuarios WHERE username = 'admin')
BEGIN
    INSERT INTO planeacion.usuarios (username, password_hash, nombre, rol)
    VALUES (
        'admin',
        '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',  -- 'admin123'
        'Administrador KOS',
        'admin'
    );
    PRINT 'Usuario admin creado (contraseña: admin123 — CAMBIAR)';
END
GO

PRINT '=== Migración 001 completada exitosamente ===';
GO
