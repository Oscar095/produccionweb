from typing import List, Optional
from pydantic import BaseModel


class PermisoModuloIn(BaseModel):
    modulo: str
    puede_ver: bool = False
    puede_crear: bool = False
    puede_editar: bool = False
    puede_eliminar: bool = False


class PermisoModuloOut(BaseModel):
    modulo: str
    puede_ver: bool
    puede_crear: bool
    puede_editar: bool
    puede_eliminar: bool

    model_config = {"from_attributes": True}


class RolCreate(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    permisos: List[PermisoModuloIn] = []


class RolUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None


class RolOut(BaseModel):
    id: int
    nombre: str
    descripcion: Optional[str]
    activo: bool
    permisos: List[PermisoModuloOut]

    model_config = {"from_attributes": True}
