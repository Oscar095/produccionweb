from datetime import date
from typing import List, Literal, Optional
from pydantic import BaseModel

EstadoOp = Literal["A tiempo", "Completada tarde", "Atrasada", "En plazo", "Completada"]


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
    # oee (componentes: valor lleva el OEE%)
    disponibilidad_pct: Optional[float] = None
    rendimiento_pct: Optional[float] = None
    calidad_pct: Optional[float] = None


class OpTasaServicioOut(BaseModel):
    op_docto: int
    item: Optional[str] = None
    referencia: Optional[str] = None      # ext1 (referencia/color)
    marca: Optional[str] = None
    maquina_id: Optional[int] = None
    maquina_nombre: Optional[str] = None
    fecha_prometida: date
    fecha_completada: Optional[date] = None  # fecha del último registro de producción
    cantidad: int
    cant_consumida: int
    pct_completado: float
    estado: EstadoOp
    dias_atraso: Optional[int] = None     # días de retraso (positivo = retrasado)


class IndicadorOut(BaseModel):
    kpi: str  # tasa_servicio | disponibilidad | eficiencia | calidad
    periodo: PeriodoIndicadorOut
    meta: Optional[float] = None
    valor_periodo: float
    por_semana: List[SemanaValorOut]
    por_maquina: List[MaquinaValorOut]
