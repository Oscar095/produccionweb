from datetime import date
from typing import List, Literal, Optional
from pydantic import BaseModel


class PeriodoIndicadorOut(BaseModel):
    inicio: date
    fin: date
    mes_label: str  # ej. "Mayo 2026"


class SemanaValorOut(BaseModel):
    semana_label: str  # ej. "Sem 21 (18-22 May)"
    inicio: date
    fin: date
    valor: float
    estado: Literal["pasada", "en_curso", "futura"] = "pasada"


class MaquinaValorOut(BaseModel):
    maquina_id: int
    maquina_nombre: Optional[str] = None
    valor: float
    # Campos detallados por KPI (opcionales — se rellenan según el KPI)
    dias_trabajados: Optional[int] = None
    # disponibilidad
    horas_disponibles: Optional[float] = None
    horas_parada: Optional[float] = None
    # eficiencia
    horas_operativas: Optional[float] = None
    capacidad_hora: Optional[int] = None
    produccion_real: Optional[int] = None
    produccion_teorica: Optional[float] = None
    # calidad
    produccion_buena: Optional[int] = None
    clase_b: Optional[int] = None
    desecho: Optional[int] = None
    produccion_total: Optional[int] = None
    # tasa_servicio
    total_ops: Optional[int] = None
    ops_atrasadas: Optional[int] = None


class IndicadorOut(BaseModel):
    kpi: str  # tasa_servicio | disponibilidad | eficiencia | calidad
    periodo: PeriodoIndicadorOut
    meta: Optional[float] = None
    valor_periodo: float
    por_semana: List[SemanaValorOut]
    por_maquina: List[MaquinaValorOut]
