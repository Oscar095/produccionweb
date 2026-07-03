from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, computed_field


class CentroCostosOut(BaseModel):
    Id: int
    centro: str
    tipo_inv: Optional[str] = None

    model_config = {"from_attributes": True}


class MaquinaOut(BaseModel):
    Id: int
    nombre: str
    capacidad_hora: int
    centro_costos_id: int
    estado: int
    estado_descripcion: Optional[str] = None

    model_config = {"from_attributes": True}


class OpNumeroOut(BaseModel):
    Id: int
    docto: int
    item: str
    marca: Optional[str] = None
    cantidad: Optional[int] = None
    cant_consumida: Optional[int] = None
    lote: Optional[str] = None
    und_medida: Optional[str] = None
    ext1: Optional[str] = None
    ext2: Optional[str] = None
    ruta_op: Optional[str] = None
    created_at: Optional[datetime] = None

    @computed_field
    @property
    def estado(self) -> str:
        cant = self.cantidad or 0
        consumida = self.cant_consumida or 0
        if consumida <= 0:
            return "Pendiente"
        if consumida >= cant:
            return "Completado"
        return "En proceso"

    @computed_field
    @property
    def pct_completado(self) -> float:
        cant = self.cantidad or 0
        if cant == 0:
            return 0.0
        return round(min((self.cant_consumida or 0) / cant * 100, 100), 1)

    model_config = {"from_attributes": True}


class KPIProduccionOut(BaseModel):
    total_ordenes: int
    completadas: int
    en_proceso: int
    pendientes: int
    sin_asignar: int
    pct_completado: float
    mes_total: int
    mes_atrasadas: int
    tasa_servicio: float


class MaquinaAvailabilityOut(BaseModel):
    maquina_id: int
    maquina_nombre: Optional[str] = None
    dias_trabajados: int
    horas_disponibles: float
    horas_parada: float
    disponibilidad_pct: float


class PeriodoOut(BaseModel):
    inicio: date
    fin: date


class EquipmentAvailabilityOut(BaseModel):
    disponibilidad_pct: float
    horas_disponibles_total: float
    horas_parada_total: float
    maquinas_evaluadas: int
    periodo: PeriodoOut
    por_maquina: List[MaquinaAvailabilityOut]


class MaquinaEficienciaOut(BaseModel):
    maquina_id: int
    maquina_nombre: Optional[str] = None
    dias_trabajados: int
    horas_operativas: float        # L-V 24h + Sáb 8h + Dom 8h-si-trabajó (sin paradas)
    capacidad_hora: int
    produccion_real: int           # produccion + clase_b + desecho
    produccion_teorica: float      # capacidad_hora × horas_operativas
    eficiencia_pct: float


class EquipmentEfficiencyOut(BaseModel):
    eficiencia_pct: float
    produccion_real_total: int
    produccion_teorica_total: float
    maquinas_evaluadas: int
    periodo: PeriodoOut
    por_maquina: List[MaquinaEficienciaOut]


class MaquinaCalidadOut(BaseModel):
    maquina_id: int
    maquina_nombre: Optional[str] = None
    produccion_buena: int          # produccion
    clase_b: int
    desecho: int                   # desecho normalizado a unidades (desde Kg)
    desecho_kg: float = 0.0        # desecho original en Kg
    produccion_total: int          # produccion + clase_b + desecho (todo en und)
    calidad_pct: float


class EquipmentQualityOut(BaseModel):
    calidad_pct: float
    produccion_buena_total: int
    produccion_total: int
    maquinas_evaluadas: int
    periodo: PeriodoOut
    por_maquina: List[MaquinaCalidadOut]


class MaquinaOEEOut(BaseModel):
    maquina_id: int
    maquina_nombre: Optional[str] = None
    disponibilidad_pct: float
    rendimiento_pct: float
    calidad_pct: float
    oee_pct: float


class EquipmentOEEOut(BaseModel):
    oee_pct: float
    disponibilidad_pct: float
    rendimiento_pct: float
    calidad_pct: float
    maquinas_evaluadas: int
    periodo: PeriodoOut
    por_maquina: List[MaquinaOEEOut]


class PersonalPlantaOut(BaseModel):
    Id: int
    nombre_operario: str
    cargo: Optional[int] = None
    cargo_nombre: Optional[str] = None

    model_config = {"from_attributes": True}


class RegistroProduccionCreate(BaseModel):
    fecha: datetime
    maquina: int
    numero_op: int
    operario: int
    produccion: int
    clase_b: int = 0
    desecho: int = 0
    lider_turno: int
    lote: Optional[str] = None
    kg_lote: Optional[int] = None


class RegistroProduccionOut(BaseModel):
    Id: int
    fecha: datetime
    maquina: int
    maquina_nombre: Optional[str] = None
    numero_op: int
    item: Optional[str] = None
    marca: Optional[str] = None
    operario: int
    operario_nombre: Optional[str] = None
    produccion: int
    clase_b: Optional[int] = None
    desecho: Optional[int] = None
    lider_turno: int
    lider_nombre: Optional[str] = None
    lote: Optional[str] = None
    kg_lote: Optional[int] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
