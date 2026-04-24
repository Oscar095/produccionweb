from typing import Optional
from pydantic import BaseModel


class CentroCostosOut(BaseModel):
    id: int
    centro: str

    model_config = {"from_attributes": True}


class EstadoMaquinaOut(BaseModel):
    id: int
    estado_descripcion: str

    model_config = {"from_attributes": True}


class RutaSiesaOut(BaseModel):
    id: int
    nombre_ruta: str
    descripcion: Optional[str] = None
    activo: bool

    model_config = {"from_attributes": True}


class RutaSiesaCreate(BaseModel):
    nombre_ruta: str
    descripcion: Optional[str] = None


class RutaSiesaUpdate(BaseModel):
    nombre_ruta: Optional[str] = None
    descripcion: Optional[str] = None
    activo: Optional[bool] = None


class MaquinaCreate(BaseModel):
    nombre: str
    capacidad_hora: int
    centro_costos_id: int
    estado_id: int
    rutas_siesa_id: Optional[int] = None


class MaquinaUpdate(BaseModel):
    nombre: Optional[str] = None
    capacidad_hora: Optional[int] = None
    centro_costos_id: Optional[int] = None
    estado_id: Optional[int] = None
    rutas_siesa_id: Optional[int] = None


class MaquinaOut(BaseModel):
    id: int
    nombre: str
    capacidad_hora: int
    centro_costos_id: int
    centro_costos: Optional[str] = None
    estado_id: int
    estado_descripcion: Optional[str] = None
    rutas_siesa_id: Optional[int] = None
    rutas_siesa_nombre: Optional[str] = None

    model_config = {"from_attributes": True}
