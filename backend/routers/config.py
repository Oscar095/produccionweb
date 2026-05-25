from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import cast, NVARCHAR
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_roles
from models.production import Maquina, CentroCostos
from models.maintenance import EstadoMaquina
from models.planning import RutaSiesa, MetaKPI
from schemas.config import (
    MaquinaCreate, MaquinaUpdate, MaquinaOut,
    CentroCostosOut, EstadoMaquinaOut,
    RutaSiesaOut, RutaSiesaCreate, RutaSiesaUpdate,
    MetaKPIOut, MetaKPIUpdate,
)

router = APIRouter(prefix="/api/config", tags=["config"])


def _maquina_to_out(m: Maquina) -> MaquinaOut:
    return MaquinaOut(
        id=m.Id,
        nombre=m.nombre or "",
        capacidad_hora=m.capacidad_hora or 0,
        centro_costos_id=m.centro_costos_id,
        centro_costos=m.centro_costos.centro if m.centro_costos else None,
        estado_id=m.estado,
        estado_descripcion=m.estado_obj.estado_descripcion if m.estado_obj else None,
        rutas_siesa_id=m.rutas_siesa_id,
        rutas_siesa_nombre=m.ruta_siesa_obj.nombre_ruta if m.ruta_siesa_obj else None,
        calcula_capacidad=bool(m.calcula_capacidad) if m.calcula_capacidad is not None else True,
    )


# ─── Máquinas ────────────────────────────────────────────────────────────────

@router.get("/maquinas", response_model=List[MaquinaOut])
def list_maquinas(db: Session = Depends(get_db), _=Depends(get_current_user)):
    maquinas = db.query(Maquina).order_by(Maquina.Id).all()
    return [_maquina_to_out(m) for m in maquinas]


@router.post("/maquinas", response_model=MaquinaOut)
def create_maquina(
    body: MaquinaCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador")),
):
    cc = db.query(CentroCostos).filter(CentroCostos.Id == body.centro_costos_id).first()
    if not cc:
        raise HTTPException(status_code=400, detail="Centro de costos no encontrado")
    em = db.query(EstadoMaquina).filter(EstadoMaquina.Id == body.estado_id).first()
    if not em:
        raise HTTPException(status_code=400, detail="Estado de máquina no encontrado")
    if body.rutas_siesa_id is not None:
        rs = db.query(RutaSiesa).filter(RutaSiesa.id == body.rutas_siesa_id).first()
        if not rs:
            raise HTTPException(status_code=400, detail="Ruta SIESA no encontrada")
    try:
        m = Maquina(
            nombre=body.nombre,
            capacidad_hora=body.capacidad_hora,
            centro_costos_id=body.centro_costos_id,
            estado=body.estado_id,
            rutas_siesa_id=body.rutas_siesa_id,
            calcula_capacidad=body.calcula_capacidad,
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return _maquina_to_out(m)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al crear máquina: {str(e)}")


@router.patch("/maquinas/{maquina_id}", response_model=MaquinaOut)
def update_maquina(
    maquina_id: int,
    body: MaquinaUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    m = db.query(Maquina).filter(Maquina.Id == maquina_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Máquina no encontrada")

    if body.nombre is not None:
        m.nombre = body.nombre
    if body.capacidad_hora is not None:
        m.capacidad_hora = body.capacidad_hora
    if body.centro_costos_id is not None:
        cc = db.query(CentroCostos).filter(CentroCostos.Id == body.centro_costos_id).first()
        if not cc:
            raise HTTPException(status_code=400, detail="Centro de costos no encontrado")
        m.centro_costos_id = body.centro_costos_id
    if body.estado_id is not None:
        em = db.query(EstadoMaquina).filter(EstadoMaquina.Id == body.estado_id).first()
        if not em:
            raise HTTPException(status_code=400, detail="Estado de máquina no encontrado")
        m.estado = body.estado_id
    if body.rutas_siesa_id is not None:
        rs = db.query(RutaSiesa).filter(RutaSiesa.id == body.rutas_siesa_id).first()
        if not rs:
            raise HTTPException(status_code=400, detail="Ruta SIESA no encontrada")
        m.rutas_siesa_id = body.rutas_siesa_id
    elif body.rutas_siesa_id == 0:
        m.rutas_siesa_id = None
    if body.calcula_capacidad is not None:
        m.calcula_capacidad = body.calcula_capacidad

    db.commit()
    db.refresh(m)
    return _maquina_to_out(m)


# ─── Centros de costos ────────────────────────────────────────────────────────

@router.get("/centros-costos", response_model=List[CentroCostosOut])
def list_centros_costos(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = db.query(CentroCostos).order_by(cast(CentroCostos.centro, NVARCHAR(200))).all()
    return [CentroCostosOut(id=c.Id, centro=c.centro or "") for c in items]


# ─── Estados de máquinas ──────────────────────────────────────────────────────

@router.get("/estados-maquinas", response_model=List[EstadoMaquinaOut])
def list_estados_maquinas(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = db.query(EstadoMaquina).order_by(EstadoMaquina.Id).all()
    return [EstadoMaquinaOut(id=e.Id, estado_descripcion=e.estado_descripcion or "") for e in items]


# ─── Rutas SIESA ──────────────────────────────────────────────────────────────

@router.get("/rutas-siesa", response_model=List[RutaSiesaOut])
def list_rutas_siesa(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = db.query(RutaSiesa).order_by(RutaSiesa.orden, RutaSiesa.nombre_ruta).all()
    return items


@router.post("/rutas-siesa", response_model=RutaSiesaOut)
def create_ruta_siesa(
    body: RutaSiesaCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador")),
):
    existing = db.query(RutaSiesa).filter(RutaSiesa.nombre_ruta == body.nombre_ruta).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe una ruta con ese nombre")
    try:
        rs = RutaSiesa(
            nombre_ruta=body.nombre_ruta,
            descripcion=body.descripcion,
            orden=body.orden or 0,
        )
        db.add(rs)
        db.commit()
        db.refresh(rs)
        return rs
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al crear ruta: {str(e)}")


@router.patch("/rutas-siesa/{ruta_id}", response_model=RutaSiesaOut)
def update_ruta_siesa(
    ruta_id: int,
    body: RutaSiesaUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    rs = db.query(RutaSiesa).filter(RutaSiesa.id == ruta_id).first()
    if not rs:
        raise HTTPException(status_code=404, detail="Ruta SIESA no encontrada")

    if body.nombre_ruta is not None:
        existing = db.query(RutaSiesa).filter(
            RutaSiesa.nombre_ruta == body.nombre_ruta,
            RutaSiesa.id != ruta_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Ya existe una ruta con ese nombre")
        rs.nombre_ruta = body.nombre_ruta
    if body.descripcion is not None:
        rs.descripcion = body.descripcion
    if body.orden is not None:
        rs.orden = body.orden
    if body.activo is not None:
        rs.activo = body.activo

    db.commit()
    db.refresh(rs)
    return rs


# ─── Metas KPI ───────────────────────────────────────────────────────────────

@router.get("/metas", response_model=List[MetaKPIOut])
def list_metas(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(MetaKPI).order_by(MetaKPI.id).all()


@router.put("/metas/{kpi}", response_model=MetaKPIOut)
def update_meta(
    kpi: str,
    body: MetaKPIUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador")),
):
    meta = db.query(MetaKPI).filter(MetaKPI.kpi == kpi).first()
    if not meta:
        raise HTTPException(status_code=404, detail=f"KPI '{kpi}' no encontrado")
    meta.valor = body.valor
    db.commit()
    db.refresh(meta)
    return meta
