"""
Autenticación JWT para KOS Xpress.
Roles dinámicos almacenados en planeacion.roles.
Token expira en 8 horas (duración de un turno de trabajo).
Usa bcrypt directamente (compatible Python 3.11–3.14+).
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from database import get_db
from models.planning import Usuario

SECRET_KEY = "kos-xpress-secret-2024-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def authenticate_user(db: Session, username: str, password: str) -> Optional[Usuario]:
    user = db.query(Usuario).filter(
        Usuario.username == username,
        Usuario.activo == True,
    ).first()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales invalidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(Usuario).filter(
        Usuario.username == username,
        Usuario.activo == True,
    ).first()
    if user is None:
        raise credentials_exception
    return user


def require_roles(*roles: str):
    """Dependency factory para requerir uno o más roles."""
    def checker(current_user: Usuario = Depends(get_current_user)) -> Usuario:
        if current_user.rol not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Se requiere rol: {' o '.join(roles)}",
            )
        return current_user
    return checker


def require_permiso(modulo: str, accion: str = "puede_ver"):
    """Dependency factory para requerir un permiso granular del rol del usuario.
    'Administrador' siempre tiene acceso. Para los demás se consulta planeacion.rol_permisos.
    """
    from models.planning import RolPermiso  # import local para evitar ciclos

    def checker(
        current_user: Usuario = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> Usuario:
        if current_user.rol == "Administrador":
            return current_user
        if not current_user.rol_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Sin permiso para '{modulo}': el usuario no tiene rol asignado",
            )
        permiso = (
            db.query(RolPermiso)
            .filter(RolPermiso.rol_id == current_user.rol_id, RolPermiso.modulo == modulo)
            .first()
        )
        if not permiso or not getattr(permiso, accion, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Sin permiso '{accion}' para el módulo '{modulo}'",
            )
        return current_user

    return checker
