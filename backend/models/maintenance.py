"""
Modelos SQLAlchemy para tablas de mantenimiento (dbo.*).
Solo lectura — no se modifica el esquema existente.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class EstadoMaquina(Base):
    __tablename__ = "estados_maquinas"
    __table_args__ = {"schema": "dbo"}

    Id                  = Column(Integer, primary_key=True)
    created_at          = Column(DateTime)
    estado_descripcion  = Column(Text, nullable=False)
    # 1 = En Mantenimiento, 2 = Disponible


class EstadoSolicitud(Base):
    __tablename__ = "estados_solicitudes_mantenimiento"
    __table_args__ = {"schema": "dbo"}

    Id                           = Column(Integer, primary_key=True)
    created_at                   = Column(DateTime)
    estado_descripcion_solicitud = Column(Text, nullable=False)
    # 1 = En proceso, 2 = Solucionado, 3 = Cancelado


class AsuntoMantenimiento(Base):
    __tablename__ = "asuntos_mantenimiento"
    __table_args__ = {"schema": "dbo"}

    Id         = Column(Integer, primary_key=True)
    created_at = Column(DateTime)
    asunto     = Column(Text, nullable=False)


class MotivoMantenimiento(Base):
    __tablename__ = "motivos_mantenimiento"
    __table_args__ = {"schema": "dbo"}

    Id         = Column(Integer, primary_key=True)
    created_at = Column(DateTime)
    motivo     = Column(Text, nullable=False)


class SolicitudMantenimiento(Base):
    """
    Ticket de mantenimiento = parada de máquina.
    - row_estado = 1 (En proceso) → máquina PARADA
    - Duración de parada: fecha → fecha_solucion
    """
    __tablename__ = "solicitudes_mantenimiento"
    __table_args__ = {"schema": "dbo", "implicit_returning": False}

    Id                   = Column(Integer, primary_key=True)
    created_at           = Column(DateTime)
    fecha                = Column(DateTime, nullable=False)
    ticket               = Column(Text, nullable=False)
    row_maquina          = Column(Integer, ForeignKey("dbo.maquinas.Id"), nullable=False)
    row_operario         = Column(Integer, ForeignKey("dbo.personal_planta.Id"))
    row_motivo           = Column(Integer, ForeignKey("dbo.motivos_mantenimiento.Id"))
    row_asunto           = Column(Integer, ForeignKey("dbo.asuntos_mantenimiento.Id"))
    descripcion_problema = Column(Text)
    row_mecanico         = Column(Integer, ForeignKey("dbo.personal_planta.Id"))
    row_estado           = Column(Integer, ForeignKey("dbo.estados_solicitudes_mantenimiento.Id"), default=1)
    fecha_solucion       = Column(DateTime)
    id_appsheet          = Column(String(50))

    maquina_obj  = relationship("Maquina", back_populates="solicitudes")
    estado_obj   = relationship("EstadoSolicitud")
    asunto_obj   = relationship("AsuntoMantenimiento")
    motivo_obj   = relationship("MotivoMantenimiento")
    bitacoras    = relationship("BitacoraSolicitud", back_populates="ticket_obj")


class BitacoraSolicitud(Base):
    __tablename__ = "bitacora_solicitudes"
    __table_args__ = {"schema": "dbo", "implicit_returning": False}

    Id            = Column(Integer, primary_key=True)
    created_at    = Column(DateTime)
    fecha         = Column(DateTime, nullable=False)
    row_mecanico  = Column(Integer, ForeignKey("dbo.personal_planta.Id"))
    bitacora      = Column(Text, nullable=False)
    observaciones = Column(Text)
    id_repuesto   = Column(Integer)
    cantidad      = Column(Integer)
    row_ticket    = Column(Integer, ForeignKey("dbo.solicitudes_mantenimiento.Id"))
    Tipo          = Column(Text)
    row_appsheet  = Column(String(50))

    ticket_obj = relationship("SolicitudMantenimiento", back_populates="bitacoras")


class Existencia(Base):
    """Inventario de repuestos — dbo.existencias (solo lectura)."""
    __tablename__ = "existencias"
    __table_args__ = {"schema": "dbo"}

    Id              = Column(Integer, primary_key=True)
    Id_item         = Column(Integer)
    item            = Column(Text, nullable=False)
    costo_unitario  = Column(Integer)
    existencia      = Column(Integer)
