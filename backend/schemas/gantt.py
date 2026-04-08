from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class GanttTarea(BaseModel):
    """Una barra en el diagrama de Gantt."""
    id: str                      # "asig-{id}" o "mant-{id}"
    texto: str                   # etiqueta visible
    inicio: datetime
    fin: datetime
    progreso: float              # 0.0 – 1.0
    tipo: str                    # "orden" | "mantenimiento" | "parada_programada"
    estado: str                  # Pendiente | En proceso | Completado | En Mantenimiento
    maquina_id: int
    maquina_nombre: str
    op_docto: Optional[int] = None
    item: Optional[str] = None
    marca: Optional[str] = None
    cantidad: Optional[int] = None
    cant_consumida: Optional[int] = None
    horas_estimadas: Optional[float] = None
    color: Optional[str] = None  # hex color para override en frontend


class GanttRecurso(BaseModel):
    """Fila (recurso/máquina) en el Gantt."""
    id: int
    nombre: str
    capacidad_hora: int
    centro: Optional[str] = None
    sobrecargada: bool = False


class GanttDataOut(BaseModel):
    recursos: List[GanttRecurso]
    tareas: List[GanttTarea]
    desde: datetime
    hasta: datetime
