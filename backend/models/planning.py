"""
Modelos SQLAlchemy para tablas NUEVAS en esquema planeacion.*.
Estas son las únicas tablas que la plataforma escribe.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base


class Rol(Base):
    __tablename__ = "roles"
    __table_args__ = {"schema": "planeacion"}

    id          = Column(Integer, primary_key=True)
    nombre      = Column(String(100), nullable=False, unique=True)
    descripcion = Column(String(255))
    activo      = Column(Boolean, default=True)
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    permisos = relationship("RolPermiso", back_populates="rol", cascade="all, delete-orphan")
    usuarios = relationship("Usuario", back_populates="rol_obj")


class RolPermiso(Base):
    __tablename__ = "rol_permisos"
    __table_args__ = {"schema": "planeacion"}

    id             = Column(Integer, primary_key=True)
    rol_id         = Column(Integer, ForeignKey("planeacion.roles.id"), nullable=False)
    modulo         = Column(String(50), nullable=False)
    puede_ver      = Column(Boolean, default=False)
    puede_crear    = Column(Boolean, default=False)
    puede_editar   = Column(Boolean, default=False)
    puede_eliminar = Column(Boolean, default=False)

    rol = relationship("Rol", back_populates="permisos")


class Usuario(Base):
    """Usuarios del sistema KOS Xpress (independiente de AppSheet)."""
    __tablename__ = "usuarios"
    __table_args__ = {"schema": "planeacion"}

    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    nombre        = Column(String(100), nullable=False)
    rol           = Column(String(100), nullable=False, default="operador")
    activo        = Column(Boolean, nullable=False, default=True)
    created_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    rol_id        = Column(Integer, ForeignKey("planeacion.roles.id"), nullable=True)

    rol_obj = relationship("Rol", back_populates="usuarios")


class Asignacion(Base):
    """
    Asignación de una orden de producción a una máquina con fechas planificadas.
    El supervisor crea/actualiza estas asignaciones en el módulo de planeación.
    """
    __tablename__ = "asignaciones"
    __table_args__ = {"schema": "planeacion"}

    id               = Column(Integer, primary_key=True, index=True)
    op_docto         = Column(Integer, nullable=False, index=True)   # = op_numeros.docto
    maquina_id       = Column(Integer, ForeignKey("dbo.maquinas.Id"), nullable=False, index=True)
    fecha_inicio_plan = Column(DateTime, nullable=False)
    fecha_fin_plan    = Column(DateTime, nullable=False)
    prioridad        = Column(Integer, nullable=False, default=100)   # menor = más urgente
    suspendida       = Column(Boolean, nullable=False, default=False)
    motivo_suspension = Column(Text)
    created_at       = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at       = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                              onupdate=lambda: datetime.now(timezone.utc))

    maquina_obj = relationship("Maquina", back_populates="asignaciones")


class ParadaProgramada(Base):
    """
    Paradas de mantenimiento adicionales registradas manualmente (preventivos programados, etc.).
    Los tickets de AppSheet (solicitudes_mantenimiento) se consideran paradas correctivas.
    """
    __tablename__ = "paradas_programadas"
    __table_args__ = {"schema": "planeacion"}

    id          = Column(Integer, primary_key=True, index=True)
    maquina_id  = Column(Integer, ForeignKey("dbo.maquinas.Id"), nullable=False, index=True)
    inicio      = Column(DateTime, nullable=False)
    fin         = Column(DateTime, nullable=False)
    motivo      = Column(String(200), nullable=False)
    tipo        = Column(String(20), nullable=False, default="preventivo")
    # tipo: preventivo | correctivo | limpieza | otro
    created_by  = Column(Integer, ForeignKey("planeacion.usuarios.id"))
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    maquina_obj   = relationship("Maquina", back_populates="paradas_programadas")
    creado_por    = relationship("Usuario")


class KanbanPrioridad(Base):
    """
    Orden manual del Kanban por máquina.
    Clave: (maquina_id, op_docto). OPs sin fila se ordenan por OpNumero.created_at ASC.
    """
    __tablename__ = "kanban_prioridades"
    __table_args__ = (
        UniqueConstraint("maquina_id", "op_docto", name="uq_kanban_maq_op"),
        {"schema": "planeacion"},
    )

    id         = Column(Integer, primary_key=True, index=True)
    maquina_id = Column(Integer, ForeignKey("dbo.maquinas.Id"), nullable=False, index=True)
    op_docto   = Column(Integer, nullable=False, index=True)
    prioridad  = Column(Integer, nullable=False, default=100)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class ResumenSemanal(Base):
    """Registro de resúmenes semanales generados para supervisores."""
    __tablename__ = "resumen_semanal"
    __table_args__ = {"schema": "planeacion"}

    id            = Column(Integer, primary_key=True, index=True)
    semana_inicio = Column(DateTime, nullable=False)   # lunes de la semana
    semana_fin    = Column(DateTime, nullable=False)   # domingo de la semana
    generado_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    generado_por  = Column(Integer, ForeignKey("planeacion.usuarios.id"))
    pdf_path      = Column(String(500))
    enviado       = Column(Boolean, default=False)
    email_destino = Column(String(500))                # CSV de emails

    autor = relationship("Usuario")
