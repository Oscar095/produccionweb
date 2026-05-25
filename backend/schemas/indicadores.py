from datetime import date
from typing import List, Optional
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


class MaquinaValorOut(BaseModel):
    maquina_id: int
    maquina_nombre: Optional[str] = None
    valor: float


class IndicadorOut(BaseModel):
    kpi: str  # tasa_servicio | disponibilidad | eficiencia | calidad
    periodo: PeriodoIndicadorOut
    meta: Optional[float] = None
    valor_periodo: float
    por_semana: List[SemanaValorOut]
    por_maquina: List[MaquinaValorOut]
