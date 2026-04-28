from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_roles
from models.planning import Rol, RolPermiso
from schemas.roles import RolCreate, RolUpdate, RolOut, PermisoModuloOut

router = APIRouter(prefix="/api/roles", tags=["roles"])

MODULOS = ["dashboard", "ordenes", "gantt", "planeacion", "mantenimiento", "reportes", "usuarios", "configuracion", "koski_ia", "cerrar_op"]


def _build_permisos(rol: Rol) -> List[PermisoModuloOut]:
    """Devuelve un objeto de permiso por cada módulo fijo (defaults False si no existe en DB)."""
    mapa = {p.modulo: p for p in rol.permisos}
    result = []
    for m in MODULOS:
        p = mapa.get(m)
        result.append(PermisoModuloOut(
            modulo=m,
            puede_ver=bool(p.puede_ver) if p else False,
            puede_crear=bool(p.puede_crear) if p else False,
            puede_editar=bool(p.puede_editar) if p else False,
            puede_eliminar=bool(p.puede_eliminar) if p else False,
        ))
    return result


def _to_out(rol: Rol) -> RolOut:
    return RolOut(
        id=rol.id,
        nombre=rol.nombre,
        descripcion=rol.descripcion,
        activo=bool(rol.activo),
        permisos=_build_permisos(rol),
    )


@router.get("", response_model=List[RolOut])
def list_roles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    roles = db.query(Rol).filter(Rol.activo == True).order_by(Rol.id).all()
    return [_to_out(r) for r in roles]


@router.get("/{rol_id}", response_model=RolOut)
def get_rol(rol_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    rol = db.query(Rol).filter(Rol.id == rol_id).first()
    if not rol:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return _to_out(rol)


@router.post("", response_model=RolOut)
def create_rol(
    body: RolCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador")),
):
    if db.query(Rol).filter(Rol.nombre == body.nombre, Rol.activo == True).first():
        raise HTTPException(status_code=400, detail="Ya existe un rol con ese nombre")
    try:
        rol = Rol(nombre=body.nombre, descripcion=body.descripcion)
        db.add(rol)
        db.flush()
        for p in body.permisos:
            db.add(RolPermiso(
                rol_id=rol.id, modulo=p.modulo,
                puede_ver=p.puede_ver, puede_crear=p.puede_crear,
                puede_editar=p.puede_editar, puede_eliminar=p.puede_eliminar,
            ))
        db.commit()
        db.refresh(rol)
        return _to_out(rol)
    except Exception as e:
        db.rollback()
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error al crear rol: {type(e).__name__}: {str(e)}")


@router.patch("/{rol_id}", response_model=RolOut)
def update_rol(
    rol_id: int,
    body: RolUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador")),
):
    rol = db.query(Rol).filter(Rol.id == rol_id).first()
    if not rol:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(rol, k, v)
    db.commit()
    db.refresh(rol)
    return _to_out(rol)


@router.delete("/{rol_id}", response_model=RolOut)
def delete_rol(
    rol_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador")),
):
    from models.planning import Usuario
    rol = db.query(Rol).filter(Rol.id == rol_id).first()
    if not rol:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    activos = db.query(Usuario).filter(Usuario.rol_id == rol_id, Usuario.activo == True).count()
    if activos > 0:
        raise HTTPException(status_code=400, detail=f"No se puede desactivar: {activos} usuario(s) activo(s) usan este rol")
    rol.activo = False
    db.commit()
    db.refresh(rol)
    return _to_out(rol)


@router.put("/{rol_id}/permisos", response_model=RolOut)
def update_permisos(
    rol_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador")),
):
    rol = db.query(Rol).filter(Rol.id == rol_id).first()
    if not rol:
        raise HTTPException(status_code=404, detail="Rol no encontrado")

    permisos_in = body.get("permisos", [])
    # Eliminar los existentes y reemplazar
    db.query(RolPermiso).filter(RolPermiso.rol_id == rol_id).delete()
    for p in permisos_in:
        db.add(RolPermiso(
            rol_id=rol_id,
            modulo=p["modulo"],
            puede_ver=p.get("puede_ver", False),
            puede_crear=p.get("puede_crear", False),
            puede_editar=p.get("puede_editar", False),
            puede_eliminar=p.get("puede_eliminar", False),
        ))
    db.commit()
    db.refresh(rol)
    return _to_out(rol)
