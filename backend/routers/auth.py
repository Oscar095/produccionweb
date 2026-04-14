from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from database import get_db
from auth import authenticate_user, create_access_token, get_password_hash, get_current_user, require_roles
from models.planning import Usuario, Rol
from schemas.auth import LoginIn, TokenOut, UsuarioCreate, UsuarioOut, UsuarioUpdate, ResetPasswordIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _build_permisos(user: Usuario) -> dict:
    if not user.rol_id or not user.rol_obj:
        return {}
    return {
        p.modulo: {
            "ver": bool(p.puede_ver),
            "crear": bool(p.puede_crear),
            "editar": bool(p.puede_editar),
            "eliminar": bool(p.puede_eliminar),
        }
        for p in user.rol_obj.permisos
    }


def _usuario_out(user: Usuario) -> UsuarioOut:
    return UsuarioOut(
        id=user.id,
        username=user.username,
        nombre=user.nombre,
        rol=user.rol,
        activo=user.activo,
        rol_id=user.rol_id,
        rol_nombre=user.rol_obj.nombre if user.rol_obj else None,
    )


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = (
        db.query(Usuario)
        .options(joinedload(Usuario.rol_obj).joinedload(Rol.permisos))
        .filter(Usuario.username == body.username, Usuario.activo == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario o contraseña incorrectos")
    from auth import verify_password
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario o contraseña incorrectos")

    token = create_access_token({"sub": user.username})
    return TokenOut(
        access_token=token,
        token_type="bearer",
        rol=user.rol,
        nombre=user.nombre,
        rol_id=user.rol_id,
        permisos=_build_permisos(user),
    )


@router.post("/usuarios", response_model=UsuarioOut, dependencies=[Depends(require_roles("Administrador"))])
def crear_usuario(body: UsuarioCreate, db: Session = Depends(get_db)):
    if db.query(Usuario).filter(Usuario.username == body.username).first():
        raise HTTPException(status_code=400, detail="El usuario ya existe")
    rol = db.query(Rol).filter(Rol.id == body.rol_id, Rol.activo == True).first()
    if not rol:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    user = Usuario(
        username=body.username,
        password_hash=get_password_hash(body.password),
        nombre=body.nombre,
        rol=rol.nombre,
        rol_id=body.rol_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _usuario_out(user)


@router.get("/me", response_model=UsuarioOut)
def me(current_user: Usuario = Depends(get_current_user)):
    return _usuario_out(current_user)


@router.get("/usuarios", response_model=List[UsuarioOut], dependencies=[Depends(require_roles("Administrador"))])
def list_usuarios(db: Session = Depends(get_db)):
    users = db.query(Usuario).options(joinedload(Usuario.rol_obj)).order_by(Usuario.username).all()
    return [_usuario_out(u) for u in users]


@router.get("/usuarios/{user_id}", response_model=UsuarioOut, dependencies=[Depends(require_roles("Administrador"))])
def get_usuario(user_id: int, db: Session = Depends(get_db)):
    user = db.query(Usuario).options(joinedload(Usuario.rol_obj)).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return _usuario_out(user)


@router.patch("/usuarios/{user_id}", response_model=UsuarioOut, dependencies=[Depends(require_roles("Administrador"))])
def update_usuario(user_id: int, body: UsuarioUpdate, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if body.rol_id is not None:
        rol = db.query(Rol).filter(Rol.id == body.rol_id, Rol.activo == True).first()
        if not rol:
            raise HTTPException(status_code=404, detail="Rol no encontrado")
        user.rol_id = body.rol_id
        user.rol = rol.nombre
    if body.nombre is not None:
        user.nombre = body.nombre
    if body.activo is not None:
        user.activo = body.activo
    db.commit()
    db.refresh(user)
    return _usuario_out(user)


@router.delete("/usuarios/{user_id}", response_model=UsuarioOut, dependencies=[Depends(require_roles("Administrador"))])
def delete_usuario(user_id: int, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.activo = False
    db.commit()
    db.refresh(user)
    return _usuario_out(user)


@router.post("/usuarios/{user_id}/reset-password", response_model=UsuarioOut, dependencies=[Depends(require_roles("Administrador"))])
def reset_password(user_id: int, body: ResetPasswordIn, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.password_hash = get_password_hash(body.nueva_password)
    db.commit()
    db.refresh(user)
    return _usuario_out(user)
