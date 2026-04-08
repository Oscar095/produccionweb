from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from auth import authenticate_user, create_access_token, get_password_hash, get_current_user, require_roles
from models.planning import Usuario
from schemas.auth import LoginIn, TokenOut, UsuarioCreate, UsuarioOut, UsuarioUpdate, ResetPasswordIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = authenticate_user(db, body.username, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
        )
    token = create_access_token({"sub": user.username})
    return TokenOut(access_token=token, token_type="bearer", rol=user.rol, nombre=user.nombre)


@router.post("/usuarios", response_model=UsuarioOut, dependencies=[Depends(require_roles("admin"))])
def crear_usuario(body: UsuarioCreate, db: Session = Depends(get_db)):
    if db.query(Usuario).filter(Usuario.username == body.username).first():
        raise HTTPException(status_code=400, detail="El usuario ya existe")
    user = Usuario(
        username=body.username,
        password_hash=get_password_hash(body.password),
        nombre=body.nombre,
        rol=body.rol,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/me", response_model=UsuarioOut)
def me(current_user: Usuario = Depends(get_current_user)):
    return current_user


@router.get("/usuarios", response_model=List[UsuarioOut], dependencies=[Depends(require_roles("admin"))])
def list_usuarios(db: Session = Depends(get_db)):
    return db.query(Usuario).order_by(Usuario.username).all()


@router.get("/usuarios/{user_id}", response_model=UsuarioOut, dependencies=[Depends(require_roles("admin"))])
def get_usuario(user_id: int, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user


@router.patch("/usuarios/{user_id}", response_model=UsuarioOut, dependencies=[Depends(require_roles("admin"))])
def update_usuario(user_id: int, body: UsuarioUpdate, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/usuarios/{user_id}", response_model=UsuarioOut, dependencies=[Depends(require_roles("admin"))])
def delete_usuario(user_id: int, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.activo = False
    db.commit()
    db.refresh(user)
    return user


@router.post("/usuarios/{user_id}/reset-password", response_model=UsuarioOut, dependencies=[Depends(require_roles("admin"))])
def reset_password(user_id: int, body: ResetPasswordIn, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.password_hash = get_password_hash(body.nueva_password)
    db.commit()
    db.refresh(user)
    return user
