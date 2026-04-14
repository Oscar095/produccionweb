from pydantic import BaseModel
from typing import Optional, Dict, Any


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    rol: str
    nombre: str
    rol_id: Optional[int] = None
    permisos: Dict[str, Any] = {}


class UsuarioCreate(BaseModel):
    username: str
    password: str
    nombre: str
    rol_id: int


class UsuarioOut(BaseModel):
    id: int
    username: str
    nombre: str
    rol: str
    activo: bool
    rol_id: Optional[int] = None
    rol_nombre: Optional[str] = None

    model_config = {"from_attributes": True}


class UsuarioUpdate(BaseModel):
    nombre: Optional[str] = None
    rol_id: Optional[int] = None
    activo: Optional[bool] = None


class ResetPasswordIn(BaseModel):
    nueva_password: str
