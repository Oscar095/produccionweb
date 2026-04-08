from pydantic import BaseModel
from typing import Optional


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    rol: str
    nombre: str


class UsuarioCreate(BaseModel):
    username: str
    password: str
    nombre: str
    rol: str = "operador"


class UsuarioOut(BaseModel):
    id: int
    username: str
    nombre: str
    rol: str
    activo: bool

    model_config = {"from_attributes": True}


class UsuarioUpdate(BaseModel):
    nombre: Optional[str] = None
    rol: Optional[str] = None
    activo: Optional[bool] = None


class ResetPasswordIn(BaseModel):
    nueva_password: str
