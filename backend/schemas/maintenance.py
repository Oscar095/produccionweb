from datetime import datetime
from typing import Optional
from pydantic import BaseModel, computed_field


class SolicitudMantenimientoOut(BaseModel):
    Id: int
    fecha: datetime
    ticket: str
    row_maquina: int
    maquina_nombre: Optional[str] = None
    row_estado: Optional[int] = None
    estado_descripcion: Optional[str] = None
    descripcion_problema: Optional[str] = None
    row_motivo: Optional[int] = None
    motivo: Optional[str] = None
    row_asunto: Optional[int] = None
    asunto: Optional[str] = None
    row_mecanico: Optional[int] = None
    fecha_solucion: Optional[datetime] = None

    @computed_field
    @property
    def activa(self) -> bool:
        """True si la máquina está parada (ticket en proceso)."""
        return self.row_estado == 1

    @computed_field
    @property
    def horas_parada(self) -> Optional[float]:
        """Horas de parada si ya hay fecha de solución."""
        if self.fecha_solucion:
            delta = self.fecha_solucion - self.fecha
            return round(delta.total_seconds() / 3600, 1)
        return None

    model_config = {"from_attributes": True}


class SolicitudMantenimientoCreate(BaseModel):
    fecha: datetime
    ticket: Optional[str] = None
    row_maquina: int
    row_operario: int
    row_motivo: int
    row_asunto: int
    descripcion_problema: Optional[str] = None
    row_mecanico: Optional[int] = None


class SolicitudMantenimientoUpdate(BaseModel):
    row_estado: Optional[int] = None
    row_mecanico: Optional[int] = None
    fecha_solucion: Optional[datetime] = None


class BitacoraOut(BaseModel):
    Id: int
    fecha: datetime
    bitacora: str
    observaciones: Optional[str] = None
    id_repuesto: Optional[int] = None
    cantidad: Optional[int] = None
    Tipo: Optional[str] = None

    model_config = {"from_attributes": True}


class BitacoraCreate(BaseModel):
    fecha: datetime
    row_mecanico: int
    bitacora: str
    observaciones: Optional[str] = None
    id_repuesto: Optional[int] = None
    cantidad: Optional[int] = None
    Tipo: Optional[str] = None


class ExistenciaOut(BaseModel):
    Id: int
    Id_item: Optional[int] = None
    item: str
    costo_unitario: Optional[int] = None
    existencia: Optional[int] = None

    model_config = {"from_attributes": True}
