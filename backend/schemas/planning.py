from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class AsignacionCreate(BaseModel):
    op_docto: int
    maquina_id: int
    fecha_inicio_plan: datetime
    fecha_fin_plan: datetime
    prioridad: int = 100


class AsignacionUpdate(BaseModel):
    maquina_id: Optional[int] = None
    fecha_inicio_plan: Optional[datetime] = None
    fecha_fin_plan: Optional[datetime] = None
    prioridad: Optional[int] = None
    suspendida: Optional[bool] = None
    motivo_suspension: Optional[str] = None


class AsignacionOut(BaseModel):
    id: int
    op_docto: int
    maquina_id: int
    maquina_nombre: Optional[str] = None
    fecha_inicio_plan: datetime
    fecha_fin_plan: datetime
    prioridad: int
    suspendida: bool
    motivo_suspension: Optional[str] = None
    # datos de la orden
    item: Optional[str] = None
    marca: Optional[str] = None
    cantidad: Optional[int] = None
    cant_consumida: Optional[int] = None
    estado_op: Optional[str] = None
    pct_completado: Optional[float] = None
    # horas estimadas = cantidad / capacidad_hora
    horas_estimadas: Optional[float] = None

    model_config = {"from_attributes": True}


class PrioridadBulkItem(BaseModel):
    asignacion_id: int
    prioridad: int


class SuspenderOrdenIn(BaseModel):
    motivo: str


class ParadaProgramadaCreate(BaseModel):
    maquina_id: int
    inicio: datetime
    fin: datetime
    motivo: str
    tipo: str = "preventivo"


class ParadaProgramadaOut(BaseModel):
    id: int
    maquina_id: int
    maquina_nombre: Optional[str] = None
    inicio: datetime
    fin: datetime
    motivo: str
    tipo: str

    model_config = {"from_attributes": True}


class CapacidadMaquinaOut(BaseModel):
    maquina_id: int
    maquina_nombre: str
    capacidad_hora: int
    horas_disponibles_semana: float    # turno 8h × 5 días = 40h menos paradas
    horas_asignadas: float
    horas_paradas: float
    sobrecargada: bool


class KanbanOrdenOut(BaseModel):
    op_docto: int
    item: Optional[str] = None
    marca: Optional[str] = None
    calibre: Optional[str] = None
    cantidad: Optional[int] = None
    cant_consumida: Optional[int] = None
    estado_op: Optional[str] = None
    pct_completado: Optional[float] = None
    horas_estimadas: Optional[float] = None
    fecha_entrega: Optional[datetime] = None
    created_at: Optional[datetime] = None
    prioridad: Optional[int] = None


class KanbanColumnaOut(BaseModel):
    maquina_id: int
    maquina_nombre: str
    capacidad_hora: int
    rutas_siesa: Optional[str] = None
    ordenes: List[KanbanOrdenOut]


class KanbanPrioridadItem(BaseModel):
    op_docto: int
    prioridad: int


class KanbanBulkPrioridadIn(BaseModel):
    maquina_id: int
    items: List[KanbanPrioridadItem]
