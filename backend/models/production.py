"""
Modelos SQLAlchemy para tablas existentes de producción (dbo.*).
Solo lectura — no se modifica el esquema existente de AppSheet.
"""
from sqlalchemy import Column, Integer, BigInteger, String, Text, DateTime, Numeric, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


class CentroCostos(Base):
    __tablename__ = "centro_costos"
    __table_args__ = {"schema": "dbo"}

    Id             = Column(Integer, primary_key=True)
    created_at     = Column(DateTime)
    centro         = Column(Text)
    tipo_inv       = Column(Text)
    und            = Column(Text)

    maquinas = relationship("Maquina", back_populates="centro_costos")


class Maquina(Base):
    __tablename__ = "maquinas"
    __table_args__ = {"schema": "dbo"}

    Id               = Column(Integer, primary_key=True)
    created_at       = Column(DateTime)
    nombre           = Column(Text, nullable=False)
    capacidad_hora   = Column(Integer, nullable=False)   # unidades por hora
    centro_costos_id = Column(Integer, ForeignKey("dbo.centro_costos.Id"), nullable=False)
    estado           = Column(Integer, ForeignKey("dbo.estados_maquinas.Id"), nullable=False)
    rutas_siesa      = Column(Text)
    rutas_siesa_id   = Column(Integer, ForeignKey("planeacion.rutas_siesa.id"), nullable=True)

    centro_costos      = relationship("CentroCostos", back_populates="maquinas")
    estado_obj         = relationship("EstadoMaquina")
    ruta_siesa_obj     = relationship("RutaSiesa", back_populates="maquinas")
    registros          = relationship("RegistroProduccion", back_populates="maquina_obj")
    solicitudes        = relationship("SolicitudMantenimiento", back_populates="maquina_obj")
    asignaciones       = relationship("Asignacion", back_populates="maquina_obj")
    paradas_programadas = relationship("ParadaProgramada", back_populates="maquina_obj")


class OpNumero(Base):
    """
    Órdenes de producción.
    El campo 'docto' es el número de OP visible al usuario.
    'cant_consumida' vs 'cantidad' determina el estado:
      0              → Pendiente
      0 < x < cant  → En proceso
      x >= cant      → Completado
    """
    __tablename__ = "op_numeros"
    __table_args__ = {"schema": "dbo"}

    Id            = Column(Integer, primary_key=True)
    created_at    = Column(DateTime)
    id_item       = Column(Integer, nullable=False)
    item          = Column(Text, nullable=False)
    marca         = Column(Text)
    docto         = Column(Integer, nullable=False)   # número de OP
    tipo_inv      = Column(String(50))
    ext1          = Column(Text)                       # referencia/color
    ext2          = Column(Text)                       # máquina sugerida
    bodega        = Column(Integer)
    und_medida    = Column(Text)
    lote          = Column(String(50))
    cantidad      = Column(Integer)                    # qty pedida
    cod_barras    = Column(String(50))
    cant_consumida = Column(Integer)                   # qty producida hasta ahora
    f851_fecha_terminacion = Column(DateTime)          # fecha comprometida de entrega
    ruta_op       = Column(Integer)                    # ruta de producción asociada

    # No relationship to Asignacion — se consulta via Asignacion.op_docto == docto


class RegistroProduccion(Base):
    __tablename__ = "registro_produccion"
    __table_args__ = {"schema": "dbo", "implicit_returning": False}

    Id             = Column(Integer, primary_key=True)
    created_at     = Column(DateTime)
    fecha          = Column(DateTime, nullable=False)
    maquina        = Column(Integer, ForeignKey("dbo.maquinas.Id"), nullable=False)
    numero_op      = Column(Integer, nullable=False)   # = op_numeros.docto
    operario       = Column(Integer, ForeignKey("dbo.personal_planta.Id"))
    produccion     = Column(Integer, nullable=False)
    clase_b        = Column(Integer)
    desecho        = Column(Integer)
    lider_turno    = Column(Integer, ForeignKey("dbo.personal_planta.Id"))
    registro_siesa = Column(Integer)
    lote           = Column(Text)
    kg_lote        = Column(Integer)
    id_appsheet    = Column(String(50))
    resultado_siesa = Column(Text)

    maquina_obj    = relationship("Maquina", back_populates="registros")


class PersonalPlanta(Base):
    __tablename__ = "personal_planta"
    __table_args__ = {"schema": "dbo"}

    Id              = Column(Integer, primary_key=True)
    created_at      = Column(DateTime)
    nombre_operario = Column(Text, nullable=False)
    cedula          = Column(BigInteger, nullable=False)
    estado          = Column(Boolean, nullable=False, default=True)
    cargo           = Column(Integer, ForeignKey("dbo.cargos_planta.Id"))
