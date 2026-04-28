import os
from datetime import datetime, timedelta
from typing import List, Optional
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import cast, String, func
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_roles, require_permiso
from models.production import Maquina, OpNumero
from models.planning import Asignacion, ParadaProgramada, Usuario, KanbanPrioridad, RutaSiesa
from schemas.planning import (
    AsignacionCreate, AsignacionUpdate, AsignacionOut,
    PrioridadBulkItem, SuspenderOrdenIn,
    ParadaProgramadaCreate, ParadaProgramadaOut,
    CapacidadMaquinaOut,
    KanbanColumnaOut, KanbanOrdenOut, KanbanBulkPrioridadIn,
)
from services.planning_engine import get_capacidad_semana, get_feasibility
from services.working_hours import add_operative_hours

router = APIRouter(prefix="/api/planning", tags=["planning"])


def _calc_fecha_fin_plan(
    db: Session,
    op_docto: int,
    maquina_id: int,
    fecha_inicio_plan: datetime,
) -> datetime:
    """
    Calcula fecha_fin_plan a partir de la cantidad pendiente de la OP y la
    capacidad_hora de la máquina, sumando horas operativas (Lun-Vie 24h, sin
    sábados ni domingos). Si no hay datos suficientes para calcular, devuelve
    la misma fecha_inicio_plan (el caller debe decidir el fallback).
    """
    op = db.query(OpNumero).filter(OpNumero.docto == op_docto).first()
    maq = db.query(Maquina).filter(Maquina.Id == maquina_id).first()
    if not op or not maq or not maq.capacidad_hora:
        return fecha_inicio_plan
    pendiente = max((op.cantidad or 0) - (op.cant_consumida or 0), 0)
    if pendiente <= 0:
        return fecha_inicio_plan
    horas = pendiente / maq.capacidad_hora
    return add_operative_hours(fecha_inicio_plan, horas)


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
        calibre=op.ext2 if op else None,
        fecha_entrega=op.f851_fecha_terminacion if op else None,
        cantidad=cant,
        cant_consumida=consumida,
        estado_op=estado_op,
        pct_completado=pct,
        horas_estimadas=horas,
    )


@router.get("/board")
def get_board(
    maquina_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Tablero Kanban por máquina. Agrupa las asignaciones activas por máquina,
    ordenadas por prioridad (y OpNumero.created_at como tiebreaker)."""
    # Subquery: one row per docto with its earliest created_at (op_numeros has
    # multiple rows per docto — producto real + componentes).
    op_created_sq = (
        db.query(
            OpNumero.docto.label("docto"),
            func.min(OpNumero.created_at).label("created_at"),
        )
        .group_by(OpNumero.docto)
        .subquery()
    )

    q = db.query(Asignacion).outerjoin(
        op_created_sq, op_created_sq.c.docto == Asignacion.op_docto
    ).filter(Asignacion.suspendida == False)  # noqa: E712
    if maquina_id:
        q = q.filter(Asignacion.maquina_id == maquina_id)

    asignaciones = q.order_by(
        Asignacion.maquina_id,
        Asignacion.prioridad,
        op_created_sq.c.created_at.asc(),
    ).all()

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
        out = _asignacion_to_out(a, db)
        if out.estado_op == "Completado":
            continue
        board[key]["ordenes"].append(out.model_dump())

    board = {k: v for k, v in board.items() if v["ordenes"]}
    return {"columnas": list(board.values())}


@router.get("/kanban")
def get_kanban(
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Tablero Kanban por ruta SIESA.
    Una columna por máquina con rutas_siesa_id; las OPs se asocian por
    nombre: rutas_siesa.nombre_ruta == OpNumero.ruta_op. Solo OPs activas
    y tipo_inv='IN1430K.ex'.
    Orden: prioridad manual ASC (KanbanPrioridad) luego OpNumero.created_at ASC.

    Nota: op_numeros.ruta_op y maquinas.rutas_siesa son TEXT; la FK real es
    maquinas.rutas_siesa_id -> planeacion.rutas_siesa.id. Hacemos el match
    por nombre (con CAST para que SQL Server no falle "text vs varchar").
    """
    maquinas = (
        db.query(Maquina)
        .filter(Maquina.rutas_siesa_id.isnot(None))
        .all()
    )
    # dbo.maquinas.nombre es TEXT → SQL Server rechaza ORDER BY sobre TEXT.
    # Ordenamos en Python para evitar castear en la query.
    maquinas.sort(key=lambda m: (m.nombre or "").lower())
    if not maquinas:
        return {"columnas": []}

    ruta_ids = sorted({m.rutas_siesa_id for m in maquinas if m.rutas_siesa_id is not None})
    rutas = db.query(RutaSiesa).filter(RutaSiesa.id.in_(ruta_ids)).all()
    id_to_nombre = {r.id: r.nombre_ruta for r in rutas}
    nombres = [n for n in id_to_nombre.values() if n]

    if not nombres:
        ops = []
    else:
        ops = (
            db.query(OpNumero)
            .filter(
                cast(OpNumero.ruta_op, String(200)).in_(nombres),
                OpNumero.estados == 1,
            )
            .all()
        )

    ops_by_nombre: dict[str, list[OpNumero]] = {}
    for op in ops:
        key = str(op.ruta_op) if op.ruta_op is not None else ""
        ops_by_nombre.setdefault(key, []).append(op)

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
        nombre_ruta = id_to_nombre.get(m.rutas_siesa_id)
        ops_maq = ops_by_nombre.get(nombre_ruta, []) if nombre_ruta else []

        def _sort_key(op: OpNumero):
            prio = prio_map.get((m.Id, op.docto))
            # Prioridad manual primero (si existe), luego por fecha de terminación ASC
            return (
                0 if prio is not None else 1,
                prio if prio is not None else 0,
                op.f851_fecha_terminacion or datetime.max,
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


@router.delete("/kanban/prioridades/{maquina_id}")
def reset_kanban_prioridades(
    maquina_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    """Elimina todas las prioridades manuales de una máquina, volviendo al
    orden default (por fecha de terminación ASC)."""
    eliminadas = (
        db.query(KanbanPrioridad)
        .filter(KanbanPrioridad.maquina_id == maquina_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "eliminadas": eliminadas}


@router.patch("/kanban/prioridades")
def bulk_kanban_prioridades(
    body: KanbanBulkPrioridadIn,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
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
    current_user: Usuario = Depends(require_roles("Administrador", "Supervisor")),
):
    payload = body.model_dump()
    # If client sent the schema default (100), push the new assignment to the
    # end of the machine column so existing priorities aren't overwritten.
    if payload.get("prioridad") == 100:
        max_p = db.query(func.max(Asignacion.prioridad)).filter(
            Asignacion.maquina_id == payload["maquina_id"]
        ).scalar() or 0
        payload["prioridad"] = max_p + 1
    # Recalcular fecha_fin_plan según capacidad de la máquina y unidades
    # pendientes de la OP, contando solo horas Lun-Vie.
    payload["fecha_fin_plan"] = _calc_fecha_fin_plan(
        db,
        op_docto=payload["op_docto"],
        maquina_id=payload["maquina_id"],
        fecha_inicio_plan=payload["fecha_inicio_plan"],
    )
    a = Asignacion(**payload)
    db.add(a)
    db.commit()
    db.refresh(a)
    return _asignacion_to_out(a, db)


@router.patch("/asignaciones/{asig_id}", response_model=AsignacionOut)
def update_asignacion(
    asig_id: int,
    body: AsignacionUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    a = db.query(Asignacion).filter(Asignacion.id == asig_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asignación no encontrada")
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(a, k, v)
    # Si cambió maquina_id o fecha_inicio_plan, recalcular fecha_fin_plan
    # automáticamente (ignorando cualquier fecha_fin_plan enviada por el cliente).
    if "maquina_id" in changes or "fecha_inicio_plan" in changes:
        a.fecha_fin_plan = _calc_fecha_fin_plan(
            db,
            op_docto=a.op_docto,
            maquina_id=a.maquina_id,
            fecha_inicio_plan=a.fecha_inicio_plan,
        )
    db.commit()
    db.refresh(a)
    return _asignacion_to_out(a, db)


@router.patch("/prioridades")
def bulk_prioridades(
    items: List[PrioridadBulkItem],
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    """Actualiza prioridades en bulk (resultado de drag & drop)."""
    for item in items:
        a = db.query(Asignacion).filter(Asignacion.id == item.asignacion_id).first()
        if a:
            a.prioridad = item.prioridad
    db.commit()
    return {"ok": True, "actualizadas": len(items)}


@router.post("/asignaciones/reordenar-por-fecha/{maquina_id}")
def reordenar_por_fecha(
    maquina_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    """Reordena todas las asignaciones de una máquina por OpNumero.created_at ASC,
    reescribiendo las prioridades 1, 2, 3, ..."""
    op_created_sq = (
        db.query(
            OpNumero.docto.label("docto"),
            func.min(OpNumero.created_at).label("created_at"),
        )
        .group_by(OpNumero.docto)
        .subquery()
    )
    rows = (
        db.query(Asignacion)
          .outerjoin(op_created_sq, op_created_sq.c.docto == Asignacion.op_docto)
          .filter(Asignacion.maquina_id == maquina_id)
          .order_by(op_created_sq.c.created_at.asc(), Asignacion.created_at.asc())
          .all()
    )
    for i, a in enumerate(rows, start=1):
        a.prioridad = i
    db.commit()
    return {"ok": True, "actualizadas": len(rows)}


@router.patch("/asignaciones/{asig_id}/suspender")
def suspender_orden(
    asig_id: int,
    body: SuspenderOrdenIn,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
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
    _=Depends(require_roles("Administrador", "Supervisor")),
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
    """Proyección de entregas: parte de dbo.op_numeros (OPs activas con f851_fecha_terminacion)
    y superpone la asignación (máquina) cuando existe.
    Solo muestra el producto real (tipo_inv='1430K.ex') de cada OP; los otros 2 son componentes en proceso."""
    hoy = datetime.utcnow().date()

    all_ops = db.query(OpNumero).filter(OpNumero.f851_fecha_terminacion.isnot(None)).all()

    # Para cada docto, preferir la fila con tipo_inv='1430K.ex' (producto real); fallback a cualquiera.
    ops_by_docto: dict[int, OpNumero] = {}
    for op in all_ops:
        existing = ops_by_docto.get(op.docto)
        is_real_product = op.tipo_inv and op.tipo_inv.lower() == "1430K.ex"
        existing_is_real = existing and existing.tipo_inv and existing.tipo_inv.lower() == "1430K.ex"
        if existing is None or (is_real_product and not existing_is_real):
            ops_by_docto[op.docto] = op

    ops = list(ops_by_docto.values())

    # Overlay: asignación activa más reciente por OP para mostrar máquina
    asigs = (
        db.query(Asignacion)
        .filter(Asignacion.suspendida == False)  # noqa: E712 — SQL Server: = 0, not IS 0
        .all()
    )
    asig_map: dict[int, Asignacion] = {}
    for a in asigs:
        prev = asig_map.get(a.op_docto)
        if not prev or (a.updated_at and prev.updated_at and a.updated_at > prev.updated_at):
            asig_map[a.op_docto] = a

    maquinas = {m.Id: m for m in db.query(Maquina).all()}

    result = []
    for op in ops:
        cant = op.cantidad or 0
        consumida = op.cant_consumida or 0
        if cant > 0 and consumida >= cant:
            continue
        fp = op.f851_fecha_terminacion
        delivery = fp.date() if hasattr(fp, 'date') else fp
        dias = (delivery - hoy).days
        estado = "Pendiente" if consumida <= 0 else "En proceso"
        pct = round(min(consumida / cant * 100, 100), 1) if cant else 0.0

        a = asig_map.get(op.docto)
        maq = maquinas.get(a.maquina_id) if a else None

        result.append({
            "asignacion_id": a.id if a else None,
            "op_docto": op.docto,
            "item": op.item,
            "marca": op.marca,
            "calibre": op.ext2,
            "maquina_nombre": maq.nombre if maq else None,
            "maquina_id": a.maquina_id if a else None,
            "delivery_date": delivery.isoformat(),
            "hoy": hoy.isoformat(),
            "dias_restantes": dias,
            "estado_op": estado,
            "pct_completado": pct,
            "cantidad": cant,
            "cant_consumida": consumida,
            "atrasada": dias < 0,
            "por_vencer": 0 <= dias <= 5,
        })

    result.sort(key=lambda r: r["delivery_date"])
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
    current_user: Usuario = Depends(require_roles("Administrador", "Supervisor")),
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
    _=Depends(require_permiso("cerrar_op", "puede_ver")),
):
    """Llama al API externo de Siesa para dar por cumplida una OP."""
    url = os.getenv("API_CERRAR_OPS", "").strip()
    # Acepta ambas variantes (ConniKey/ConniToken como están en .env, o las legacy CONNI_KEY/CONNI_TOKEN)
    conni_key = (os.getenv("ConniKey") or os.getenv("CONNI_KEY") or "").strip()
    conni_token = (os.getenv("ConniToken") or os.getenv("CONNI_TOKEN") or "").strip()

    if not url or not conni_key or not conni_token:
        raise HTTPException(
            status_code=500,
            detail="API_CERRAR_OPS, ConniKey o ConniToken no configurados en .env",
        )

    headers = {
        "ConniKey": conni_key,
        "ConniToken": conni_token,
        "Content-Type": "application/json",
    }
    body = {"Documentos": [{"f850_consec_docto": str(op_docto)}]}

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
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    p = db.query(ParadaProgramada).filter(ParadaProgramada.id == parada_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Parada no encontrada")
    db.delete(p)
    db.commit()
    return {"ok": True}
