"""
Servicio Gantt: ensambla datos de órdenes asignadas + paradas de mantenimiento
en el formato GanttDataOut.
"""
from datetime import datetime
from typing import List, Optional
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from models.production import Maquina, OpNumero, CentroCostos
from models.maintenance import SolicitudMantenimiento
from models.planning import Asignacion, ParadaProgramada
from schemas.gantt import GanttDataOut, GanttRecurso, GanttTarea

# Paleta de colores por estado
COLORES = {
    "En proceso":           "#3B82F6",   # azul
    "Pendiente":            "#9CA3AF",   # gris
    "Completado":           "#22C55E",   # verde
    "Suspendida":           "#F59E0B",   # amarillo
    "En Mantenimiento":     "#EF4444",   # rojo
    "Parada Programada":    "#8B5CF6",   # violeta
}


def _estado_op(cant: Optional[int], consumida: Optional[int]) -> str:
    c = cant or 0
    cons = consumida or 0
    if cons <= 0:
        return "Pendiente"
    if cons >= c:
        return "Completado"
    return "En proceso"


def _pct(cant: Optional[int], consumida: Optional[int]) -> float:
    c = cant or 0
    if c == 0:
        return 0.0
    return min((consumida or 0) / c, 1.0)


def get_gantt_data(
    db: Session,
    desde: datetime,
    hasta: datetime,
    maquina_ids: Optional[List[int]] = None,
) -> GanttDataOut:
    # ── máquinas ──────────────────────────────────────────────
    maq_q = db.query(Maquina).options(joinedload(Maquina.centro_costos))
    if maquina_ids:
        maq_q = maq_q.filter(Maquina.Id.in_(maquina_ids))
    maquinas = maq_q.all()
    maquina_map = {m.Id: m for m in maquinas}

    recursos = [
        GanttRecurso(
            id=m.Id,
            nombre=m.nombre,
            capacidad_hora=m.capacidad_hora,
            centro=m.centro_costos.centro if m.centro_costos else None,
        )
        for m in maquinas
    ]

    tareas: List[GanttTarea] = []

    # ── asignaciones (órdenes planificadas) ───────────────────
    asig_q = (
        db.query(Asignacion)
        .filter(
            Asignacion.fecha_inicio_plan <= hasta,
            Asignacion.fecha_fin_plan   >= desde,
        )
    )
    if maquina_ids:
        asig_q = asig_q.filter(Asignacion.maquina_id.in_(maquina_ids))

    asignaciones = asig_q.all()
    op_doctos = [a.op_docto for a in asignaciones]

    # Cargar órdenes en batch
    ops = {}
    if op_doctos:
        op_rows = db.query(OpNumero).filter(OpNumero.docto.in_(op_doctos)).all()
        ops = {o.docto: o for o in op_rows}

    for a in asignaciones:
        op = ops.get(a.op_docto)
        maq = maquina_map.get(a.maquina_id)
        estado = "Suspendida" if a.suspendida else _estado_op(
            op.cantidad if op else None,
            op.cant_consumida if op else None,
        )
        horas = None
        if op and maq and op.cantidad and maq.capacidad_hora:
            horas = round(op.cantidad / maq.capacidad_hora, 2)

        tareas.append(GanttTarea(
            id=f"asig-{a.id}",
            texto=f"OP {a.op_docto} — {op.item if op else '?'}",
            inicio=a.fecha_inicio_plan,
            fin=a.fecha_fin_plan,
            progreso=_pct(op.cantidad if op else None, op.cant_consumida if op else None),
            tipo="orden",
            estado=estado,
            maquina_id=a.maquina_id,
            maquina_nombre=maq.nombre if maq else str(a.maquina_id),
            op_docto=a.op_docto,
            item=op.item if op else None,
            marca=op.marca if op else None,
            cantidad=op.cantidad if op else None,
            cant_consumida=op.cant_consumida if op else None,
            horas_estimadas=horas,
            color=COLORES.get(estado),
        ))

    # ── tickets de mantenimiento (paradas correctivas) ────────
    mant_q = db.query(SolicitudMantenimiento).filter(
        SolicitudMantenimiento.fecha <= hasta,
        or_(
            SolicitudMantenimiento.fecha_solucion >= desde,
            SolicitudMantenimiento.fecha_solucion.is_(None),   # aún abierto
        ),
    )
    if maquina_ids:
        mant_q = mant_q.filter(SolicitudMantenimiento.row_maquina.in_(maquina_ids))

    for t in mant_q.all():
        maq = maquina_map.get(t.row_maquina)
        fin = t.fecha_solucion or hasta   # si sigue abierto, llega hasta el límite del rango
        tareas.append(GanttTarea(
            id=f"mant-{t.Id}",
            texto=f"Mant. {t.ticket}",
            inicio=t.fecha,
            fin=fin,
            progreso=1.0 if t.row_estado == 2 else 0.0,
            tipo="mantenimiento",
            estado="En Mantenimiento",
            maquina_id=t.row_maquina,
            maquina_nombre=maq.nombre if maq else str(t.row_maquina),
            color=COLORES["En Mantenimiento"],
        ))

    # ── paradas programadas (preventivos) ─────────────────────
    parad_q = db.query(ParadaProgramada).filter(
        ParadaProgramada.inicio <= hasta,
        ParadaProgramada.fin    >= desde,
    )
    if maquina_ids:
        parad_q = parad_q.filter(ParadaProgramada.maquina_id.in_(maquina_ids))

    for p in parad_q.all():
        maq = maquina_map.get(p.maquina_id)
        tareas.append(GanttTarea(
            id=f"parada-{p.id}",
            texto=f"Parada: {p.motivo}",
            inicio=p.inicio,
            fin=p.fin,
            progreso=0.0,
            tipo="parada_programada",
            estado="Parada Programada",
            maquina_id=p.maquina_id,
            maquina_nombre=maq.nombre if maq else str(p.maquina_id),
            color=COLORES["Parada Programada"],
        ))

    return GanttDataOut(recursos=recursos, tareas=tareas, desde=desde, hasta=hasta)
