from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class GanttOpDetalle(BaseModel):
    """Una OP individual dentro de un Centro de Trabajo."""
    docto: int
    item: Optional[str] = None
    marca: Optional[str] = None
    cantidad: int
    cant_consumida: int
    unidades_pendientes: int
    fecha_entrega: Optional[datetime] = None
    dias_estimados: float                 # días hábiles que toma esta OP sola
    fecha_fin_proyectada: Optional[datetime] = None  # cuándo terminaría si se ejecutan en orden
    clase: str                            # "atrasada" | "en_riesgo" | "a_tiempo"
    color: str


class GanttTarea(BaseModel):
    """Barra agregada de un Centro de Trabajo, segmentada en atrasado/riesgo/a tiempo."""
    id: str                               # "carga-{ruta_id}"
    texto: str
    inicio: datetime
    fin: datetime
    tipo: str                             # "carga"
    estado: str                           # "Sin carga" | "A tiempo" | "En riesgo" | "Atrasado"
    ruta_id: int
    ruta_nombre: str
    # Totales
    num_ops: int
    unidades_total: int
    unidades_pendientes: int
    horas_estimadas: float
    dias_estimados: float
    capacidad_diaria: int
    # Segmentos (en días hábiles)
    dias_atrasado: float = 0.0
    dias_riesgo: float = 0.0
    dias_a_tiempo: float = 0.0
    num_ops_atrasado: int = 0
    num_ops_riesgo: int = 0
    num_ops_a_tiempo: int = 0
    fecha_entrega_min: Optional[datetime] = None


class GanttRecurso(BaseModel):
    """Fila del Gantt: un Centro de Trabajo (Ruta SIESA)."""
    id: int
    nombre: str
    orden: Optional[int] = None
    num_maquinas: int = 0
    capacidad_hora_total: int = 0
    capacidad_diaria: int = 0
    num_ops: int = 0
    unidades_pendientes: int = 0
    dias_estimados: float = 0.0
    sobrecargada: bool = False
    ops: List[GanttOpDetalle] = []        # detalle expandible


class GanttDataOut(BaseModel):
    recursos: List[GanttRecurso]
    tareas: List[GanttTarea]
    desde: datetime
    hasta: datetime


class CapacidadMaquinaItem(BaseModel):
    """Resumen de ocupación por máquina en el período seleccionado."""
    maquina_id: int
    maquina_nombre: str
    centro_costos: Optional[str] = None
    rutas_siesa_id: Optional[int] = None
    rutas_siesa_nombre: Optional[str] = None
    capacidad_hora: int
    horas_disponibles: float
    unidades_teoricas: int
    unidades_producidas: int
    ocupacion_pct: float


class CapacidadTendenciaPunto(BaseModel):
    """Un punto del gráfico de tendencia mensual (último año)."""
    bucket: str                       # ej. "2026-04"
    bucket_inicio: datetime
    bucket_fin: datetime
    maquina_id: int
    ocupacion_pct: float


class CapacidadesDataOut(BaseModel):
    desde: datetime
    hasta: datetime
    horas_disponibles_periodo: float
    maquinas: List[CapacidadMaquinaItem]
    tendencia_mensual: List[CapacidadTendenciaPunto]
