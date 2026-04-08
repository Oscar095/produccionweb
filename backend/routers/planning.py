from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_roles
from models.production import Maquina, OpNumero
from models.planning import Asignacion, ParadaProgramada, Usuario
from schemas.planning import (
    AsignacionCreate, AsignacionUpdate, AsignacionOut,
    PrioridadBulkItem, SuspenderOrdenIn,
    ParadaProgramadaCreate, ParadaProgramadaOut,
    CapacidadMaquinaOut,
)
from services.planning_engine import get_capacidad_semana, get_feasibility

router = APIRouter(prefix="/api/planning", tags=["planning"])


def _asignacion_to_out(a: Asignacion, db: Session) -> AsignacionOut:
    maq = db.query(Maquina).filter(Maquina.Id == a.maquina_id).first()
    op  = db.query(OpNumero).filter(OpNumero.docto == a.op_docto).first()
    cant = op.cantidad if op else None
    consumida = op.cant_consumida if op else None
    estado_op = None
    pct = None
    if op:
        c = cant or 0
        cons = consumida or 0
        estado_op = "Pendiente" if cons <= 0 else ("Completado" if cons >= c else "En proceso")
        pct = round(min(cons / c * 100, 100), 1) if c else 0.0
    horas = None
    if op and maq and op.cantidad and maq.capacidad_hora:
        horas = round(op.cantidad / maq.capacidad_hora, 2)
    return AsignacionOut(
        id=a.id,
        op_docto=a.op_docto,
        maquina_id=a.maquina_id,
        maquina_nombre=maq.nombre if maq else None,
        fecha_inicio_plan=a.fecha_inicio_plan,
        fecha_fin_plan=a.fecha_fin_plan,
        prioridad=a.prioridad,
        suspendida=a.suspendida,
        motivo_suspension=a.motivo_suspension,
        item=op.item if op else None,
        marca=op.marca if op else None,
        cantidad=cant,
        cant_consumida=consumida,
        estado_op=estado_op,
        pct_completado=pct,
        horas_estimadas=horas,
    )


@router.get("/board")
def get_board(
    semana: Optional[datetime] = Query(default=None, description="Lunes de la semana (ISO)"),
    maquina_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Tablero de planeación: órdenes agrupadas por máquina, ordenadas por prioridad."""
    if semana is None:
        hoy = datetime.utcnow().date()
        lunes = hoy - timedelta(days=hoy.weekday())
        semana = datetime.combine(lunes, datetime.min.time())

    semana_fin = semana + timedelta(days=6, hours=23, minutes=59)

    q = db.query(Asignacion).filter(
        Asignacion.fecha_inicio_plan <= semana_fin,
        Asignacion.fecha_fin_plan   >= semana,
    )
    if maquina_id:
        q = q.filter(Asignacion.maquina_id == maquina_id)

    asignaciones = q.order_by(Asignacion.maquina_id, Asignacion.prioridad).all()

    # Agrupar por máquina
    board: dict = {}
    for a in asignaciones:
        key = str(a.maquina_id)
        if key not in board:
            maq = db.query(Maquina).filter(Maquina.Id == a.maquina_id).first()
            board[key] = {
                "maquina_id": a.maquina_id,
                "maquina_nombre": maq.nombre if maq else str(a.maquina_id),
                "capacidad_hora": maq.capacidad_hora if maq else 0,
                "ordenes": [],
            }
        board[key]["ordenes"].append(_asignacion_to_out(a, db).model_dump())

    return {"semana_inicio": semana.isoformat(), "columnas": list(board.values())}


@router.post("/asignaciones", response_model=AsignacionOut)
def crear_asignacion(
    body: AsignacionCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "supervisor")),
):
    a = Asignacion(**body.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return _asignacion_to_out(a, db)


@router.patch("/asignaciones/{asig_id}", response_model=AsignacionOut)
def update_asignacion(
    asig_id: int,
    body: AsignacionUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin", "supervisor")),
):
    a = db.query(Asignacion).filter(Asignacion.id == asig_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return _asignacion_to_out(a, db)


@router.patch("/prioridades")
def bulk_prioridades(
    items: List[PrioridadBulkItem],
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin", "supervisor")),
):
    """Actualiza prioridades en bulk (resultado de drag & drop)."""
    for item in items:
        a = db.query(Asignacion).filter(Asignacion.id == item.asignacion_id).first()
        if a:
            a.prioridad = item.prioridad
    db.commit()
    return {"ok": True, "actualizadas": len(items)}


@router.patch("/asignaciones/{asig_id}/suspender")
def suspender_orden(
    asig_id: int,
    body: SuspenderOrdenIn,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin", "supervisor")),
):
    a = db.query(Asignacion).filter(Asignacion.id == asig_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    a.suspendida = True
    a.motivo_suspension = body.motivo
    db.commit()
    return {"ok": True}


@router.patch("/asignaciones/{asig_id}/reactivar")
def reactivar_orden(
    asig_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin", "supervisor")),
):
    a = db.query(Asignacion).filter(Asignacion.id == asig_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    a.suspendida = False
    a.motivo_suspension = None
    db.commit()
    return {"ok": True}


@router.get("/capacidad", response_model=List[CapacidadMaquinaOut])
def capacidad_semana(
    semana: Optional[datetime] = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if semana is None:
        hoy = datetime.utcnow().date()
        lunes = hoy - timedelta(days=hoy.weekday())
        semana = datetime.combine(lunes, datetime.min.time())
    return get_capacidad_semana(db, semana)


@router.get("/feasibility/{maquina_id}")
def feasibility(
    maquina_id: int,
    semana: Optional[datetime] = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if semana is None:
        hoy = datetime.utcnow().date()
        lunes = hoy - timedelta(days=hoy.weekday())
        semana = datetime.combine(lunes, datetime.min.time())
    return get_feasibility(db, maquina_id, semana)


@router.get("/paradas", response_model=List[ParadaProgramadaOut])
def list_paradas(db: Session = Depends(get_db), _=Depends(get_current_user)):
    paradas = db.query(ParadaProgramada).all()
    result = []
    for p in paradas:
        maq = db.query(Maquina).filter(Maquina.Id == p.maquina_id).first()
        result.append(ParadaProgramadaOut(
            id=p.id, maquina_id=p.maquina_id,
            maquina_nombre=maq.nombre if maq else None,
            inicio=p.inicio, fin=p.fin, motivo=p.motivo, tipo=p.tipo,
        ))
    return result


@router.post("/paradas", response_model=ParadaProgramadaOut)
def create_parada(
    body: ParadaProgramadaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "supervisor")),
):
    p = ParadaProgramada(**body.model_dump(), created_by=current_user.id)
    db.add(p)
    db.commit()
    db.refresh(p)
    maq = db.query(Maquina).filter(Maquina.Id == p.maquina_id).first()
    return ParadaProgramadaOut(
        id=p.id, maquina_id=p.maquina_id,
        maquina_nombre=maq.nombre if maq else None,
        inicio=p.inicio, fin=p.fin, motivo=p.motivo, tipo=p.tipo,
    )


@router.delete("/paradas/{parada_id}")
def delete_parada(
    parada_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin", "supervisor")),
):
    p = db.query(ParadaProgramada).filter(ParadaProgramada.id == parada_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Parada no encontrada")
    db.delete(p)
    db.commit()
    return {"ok": True}
