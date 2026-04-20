import os
from datetime import datetime, timedelta
from typing import List, Optional
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import cast, String
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_roles
from models.production import Maquina, OpNumero
from models.planning import Asignacion, ParadaProgramada, Usuario, KanbanPrioridad
from schemas.planning import (
    AsignacionCreate, AsignacionUpdate, AsignacionOut,
    PrioridadBulkItem, SuspenderOrdenIn,
    ParadaProgramadaCreate, ParadaProgramadaOut,
    CapacidadMaquinaOut,
    KanbanColumnaOut, KanbanOrdenOut, KanbanBulkPrioridadIn,
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


@router.get("/kanban")
def get_kanban(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Tablero Kanban por ruta SIESA.
    Una columna por máquina con rutas_siesa_id; las OPs se asocian por
    OpNumero.ruta_op == Maquina.rutas_siesa_id. Solo OPs activas y tipo_inv='IN1430K.ex'.
    Orden: prioridad manual ASC (KanbanPrioridad) luego OpNumero.created_at ASC.
    """
    maquinas = (
        db.query(Maquina)
        .filter(Maquina.rutas_siesa_id.isnot(None))
        .order_by(Maquina.nombre)
        .all()
    )
    if not maquinas:
        return {"columnas": []}

    ruta_ids = sorted({m.rutas_siesa_id for m in maquinas if m.rutas_siesa_id is not None})

    ops = (
        db.query(OpNumero)
        .filter(
            OpNumero.ruta_op.in_(ruta_ids),
            cast(OpNumero.tipo_inv, String(50)) == "IN1430K.ex",
            (OpNumero.cant_consumida.is_(None)) | (OpNumero.cant_consumida < OpNumero.cantidad),
        )
        .all()
    )

    ops_by_ruta: dict[int, list[OpNumero]] = {}
    for op in ops:
        ops_by_ruta.setdefault(op.ruta_op, []).append(op)

    maq_ids = [m.Id for m in maquinas]
    op_doctos = [op.docto for op in ops]
    prio_map: dict[tuple[int, int], int] = {}
    if maq_ids and op_doctos:
        prios = (
            db.query(KanbanPrioridad)
            .filter(
                KanbanPrioridad.maquina_id.in_(maq_ids),
                KanbanPrioridad.op_docto.in_(op_doctos),
            )
            .all()
        )
        prio_map = {(p.maquina_id, p.op_docto): p.prioridad for p in prios}

    columnas = []
    for m in maquinas:
        ops_maq = ops_by_ruta.get(m.rutas_siesa_id, [])

        def _sort_key(op: OpNumero):
            prio = prio_map.get((m.Id, op.docto))
            # Prioridad manual primero (si existe), luego por created_at ASC
            return (
                0 if prio is not None else 1,
                prio if prio is not None else 0,
                op.created_at or datetime.max,
            )

        ops_maq_sorted = sorted(ops_maq, key=_sort_key)

        ordenes = []
        for op in ops_maq_sorted:
            cant = op.cantidad or 0
            cons = op.cant_consumida or 0
            estado_op = "Pendiente" if cons <= 0 else ("Completado" if cons >= cant else "En proceso")
            pct = round(min(cons / cant * 100, 100), 1) if cant else 0.0
            horas = round(op.cantidad / m.capacidad_hora, 2) if op.cantidad and m.capacidad_hora else None
            ordenes.append(KanbanOrdenOut(
                op_docto=op.docto,
                item=op.item,
                marca=op.marca,
                calibre=op.ext1,
                cantidad=op.cantidad,
                cant_consumida=op.cant_consumida,
                estado_op=estado_op,
                pct_completado=pct,
                horas_estimadas=horas,
                fecha_entrega=op.f851_fecha_terminacion,
                created_at=op.created_at,
                prioridad=prio_map.get((m.Id, op.docto)),
            ).model_dump())

        columnas.append(KanbanColumnaOut(
            maquina_id=m.Id,
            maquina_nombre=m.nombre,
            capacidad_hora=m.capacidad_hora,
            rutas_siesa=m.rutas_siesa,
            ordenes=ordenes,
        ).model_dump())

    return {"columnas": columnas}


@router.patch("/kanban/prioridades")
def bulk_kanban_prioridades(
    body: KanbanBulkPrioridadIn,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin", "supervisor")),
):
    """Upsert bulk de prioridades manuales del Kanban por máquina."""
    actualizadas = 0
    for item in body.items:
        row = (
            db.query(KanbanPrioridad)
            .filter(
                KanbanPrioridad.maquina_id == body.maquina_id,
                KanbanPrioridad.op_docto == item.op_docto,
            )
            .first()
        )
        if row:
            row.prioridad = item.prioridad
        else:
            db.add(KanbanPrioridad(
                maquina_id=body.maquina_id,
                op_docto=item.op_docto,
                prioridad=item.prioridad,
            ))
        actualizadas += 1
    db.commit()
    return {"ok": True, "actualizadas": actualizadas}


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


@router.get("/timeline")
def get_timeline(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Proyección de entregas: OPs activas agrupadas por f851_fecha_terminacion."""
    hoy = datetime.utcnow().date()
    hoy_str = hoy.isoformat()

    # 1) OPs activas con fecha de terminación (un solo query, filtrado en BD)
    ops = (
        db.query(OpNumero)
        .filter(
            OpNumero.f851_fecha_terminacion.isnot(None),
            (OpNumero.cant_consumida.is_(None)) | (OpNumero.cant_consumida < OpNumero.cantidad),
            cast(OpNumero.tipo_inv, String(50)) == "IN1430K.ex",
        )
        .order_by(OpNumero.f851_fecha_terminacion)
        .all()
    )

    if not ops:
        return []

    # 2) Bulk: todas las asignaciones indexadas por op_docto
    doctos = [op.docto for op in ops]
    asigs = db.query(Asignacion).filter(Asignacion.op_docto.in_(doctos)).all()
    asig_map = {a.op_docto: a for a in asigs}

    # 3) Bulk: todas las máquinas necesarias
    maq_ids = {a.maquina_id for a in asigs}
    if maq_ids:
        maquinas = db.query(Maquina).filter(Maquina.Id.in_(maq_ids)).all()
        maq_map = {m.Id: m.nombre for m in maquinas}
    else:
        maq_map = {}

    # 4) Armar resultado sin queries adicionales
    result = []
    for op in ops:
        cant = op.cantidad or 0
        consumida = op.cant_consumida or 0

        estado_op = "En proceso" if consumida > 0 else "Pendiente"
        pct = round(min(consumida / cant * 100, 100), 1) if cant else 0.0

        delivery_date = op.f851_fecha_terminacion.date()
        dias_restantes = (delivery_date - hoy).days

        asig = asig_map.get(op.docto)
        maq_id = asig.maquina_id if asig else None

        result.append({
            "asignacion_id": asig.id if asig else None,
            "op_docto": op.docto,
            "item": op.item,
            "marca": op.marca,
            "calibre": op.ext1,
            "maquina_nombre": maq_map.get(maq_id) if maq_id else None,
            "maquina_id": maq_id,
            "delivery_date": delivery_date.isoformat(),
            "hoy": hoy_str,
            "dias_restantes": dias_restantes,
            "estado_op": estado_op,
            "pct_completado": pct,
            "cantidad": cant,
            "cant_consumida": consumida,
            "atrasada": dias_restantes < 0,
            "por_vencer": 0 <= dias_restantes <= 5,
        })

    return result


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


@router.post("/cerrar-op/{op_docto}")
def cerrar_op(
    op_docto: int,
    _=Depends(require_roles("admin", "supervisor")),
):
    """Llama al API externo de Siesa para dar por cumplida una OP."""
    url = os.getenv("API_CERRAR_OPS", "").strip()
    conni_key = os.getenv("CONNI_KEY", "").strip()
    conni_token = os.getenv("CONNI_TOKEN", "").strip()

    if not url or not conni_key or not conni_token:
        raise HTTPException(
            status_code=500,
            detail="API_CERRAR_OPS, CONNI_KEY o CONNI_TOKEN no configurados en .env",
        )

    headers = {
        "CONNI-KEY": conni_key,
        "CONNI-TOKEN": conni_token,
        "Content-Type": "application/json",
    }
    body = {"Documentos": [{"f850_consec_docto": op_docto}]}

    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json=body)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error al contactar Siesa: {e}")

    try:
        payload = resp.json()
    except ValueError:
        payload = {"raw": resp.text}

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=resp.status_code,
            detail={"mensaje": "Siesa rechazó la solicitud", "respuesta": payload},
        )

    return {"ok": True, "op_docto": op_docto, "respuesta": payload}


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
