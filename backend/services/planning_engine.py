"""
Motor de planeación y cálculo de capacidad.
Dado un centro de trabajo y una semana, determina:
  - Horas disponibles (turno 8h × días laborables - paradas)
  - Horas requeridas por órdenes asignadas
  - Qué órdenes son alcanzables
"""
from datetime import datetime, timedelta
from typing import List, Tuple
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from models.production import Maquina, OpNumero
from models.maintenance import SolicitudMantenimiento
from models.planning import Asignacion, ParadaProgramada
from schemas.planning import CapacidadMaquinaOut

HORAS_TURNO = 8.0          # horas productivas por día
DIAS_SEMANA_LABORABLES = 5  # lunes a viernes


def _horas_paradas_en_rango(
    db: Session,
    maquina_id: int,
    inicio: datetime,
    fin: datetime,
) -> float:
    """Suma horas de parada (tickets + paradas programadas) en el rango dado."""
    horas = 0.0

    # Tickets de mantenimiento abiertos o cerrados en el rango
    tickets = db.query(SolicitudMantenimiento).filter(
        SolicitudMantenimiento.row_maquina == maquina_id,
        SolicitudMantenimiento.fecha <= fin,
        or_(
            SolicitudMantenimiento.fecha_solucion >= inicio,
            SolicitudMantenimiento.fecha_solucion.is_(None),
        ),
    ).all()

    for t in tickets:
        t_inicio = max(t.fecha, inicio)
        t_fin = min(t.fecha_solucion or fin, fin)
        delta = (t_fin - t_inicio).total_seconds() / 3600
        horas += max(delta, 0)

    # Paradas programadas
    paradas = db.query(ParadaProgramada).filter(
        ParadaProgramada.maquina_id == maquina_id,
        ParadaProgramada.inicio <= fin,
        ParadaProgramada.fin >= inicio,
    ).all()

    for p in paradas:
        p_inicio = max(p.inicio, inicio)
        p_fin = min(p.fin, fin)
        delta = (p_fin - p_inicio).total_seconds() / 3600
        horas += max(delta, 0)

    return round(horas, 2)


def _horas_asignadas(
    db: Session,
    maquina_id: int,
    inicio: datetime,
    fin: datetime,
) -> float:
    """Suma horas estimadas de órdenes asignadas en el rango."""
    asignaciones = db.query(Asignacion).filter(
        Asignacion.maquina_id == maquina_id,
        Asignacion.suspendida == False,
        Asignacion.fecha_inicio_plan <= fin,
        Asignacion.fecha_fin_plan >= inicio,
    ).all()

    op_doctos = [a.op_docto for a in asignaciones]
    if not op_doctos:
        return 0.0

    maq = db.query(Maquina).filter(Maquina.Id == maquina_id).first()
    if not maq or not maq.capacidad_hora:
        return 0.0

    ops = {o.docto: o for o in db.query(OpNumero).filter(OpNumero.docto.in_(op_doctos)).all()}

    total = 0.0
    for a in asignaciones:
        op = ops.get(a.op_docto)
        if op and op.cantidad:
            pendiente = max((op.cantidad or 0) - (op.cant_consumida or 0), 0)
            total += pendiente / maq.capacidad_hora

    return round(total, 2)


def get_capacidad_semana(
    db: Session,
    semana_inicio: datetime,
    maquina_ids: List[int] | None = None,
) -> List[CapacidadMaquinaOut]:
    """
    Calcula capacidad disponible vs requerida para cada máquina en una semana.
    semana_inicio debe ser lunes a las 00:00.
    """
    semana_fin = semana_inicio + timedelta(days=5)  # hasta el viernes 23:59
    horas_totales = HORAS_TURNO * DIAS_SEMANA_LABORABLES

    maq_q = db.query(Maquina)
    if maquina_ids:
        maq_q = maq_q.filter(Maquina.Id.in_(maquina_ids))

    resultado = []
    for maq in maq_q.all():
        h_paradas = _horas_paradas_en_rango(db, maq.Id, semana_inicio, semana_fin)
        h_disponibles = max(horas_totales - h_paradas, 0)
        h_asignadas = _horas_asignadas(db, maq.Id, semana_inicio, semana_fin)

        resultado.append(CapacidadMaquinaOut(
            maquina_id=maq.Id,
            maquina_nombre=maq.nombre,
            capacidad_hora=maq.capacidad_hora,
            horas_disponibles_semana=h_disponibles,
            horas_asignadas=h_asignadas,
            horas_paradas=h_paradas,
            sobrecargada=h_asignadas > h_disponibles,
        ))

    return resultado


def get_feasibility(
    db: Session,
    maquina_id: int,
    semana_inicio: datetime,
) -> dict:
    """
    Retorna cuáles órdenes asignadas a una máquina en la semana son alcanzables
    dado el orden de prioridad y la capacidad disponible.
    """
    semana_fin = semana_inicio + timedelta(days=5)
    capacidad = get_capacidad_semana(db, semana_inicio, [maquina_id])
    if not capacidad:
        return {"alcanzables": [], "en_riesgo": [], "horas_disponibles": 0}

    cap = capacidad[0]
    horas_restantes = cap.horas_disponibles_semana

    asignaciones = (
        db.query(Asignacion)
        .filter(
            Asignacion.maquina_id == maquina_id,
            Asignacion.suspendida == False,
            Asignacion.fecha_inicio_plan <= semana_fin,
            Asignacion.fecha_fin_plan >= semana_inicio,
        )
        .order_by(Asignacion.prioridad.asc())
        .all()
    )

    maq = db.query(Maquina).filter(Maquina.Id == maquina_id).first()
    cap_hora = maq.capacidad_hora if maq else 1

    op_doctos = [a.op_docto for a in asignaciones]
    ops = {}
    if op_doctos:
        ops = {o.docto: o for o in db.query(OpNumero).filter(OpNumero.docto.in_(op_doctos)).all()}

    alcanzables = []
    en_riesgo = []

    for a in asignaciones:
        op = ops.get(a.op_docto)
        pendiente = max((op.cantidad or 0) - (op.cant_consumida or 0), 0) if op else 0
        horas_req = round(pendiente / cap_hora, 2) if cap_hora else 0

        if horas_restantes >= horas_req:
            alcanzables.append({"asignacion_id": a.id, "op_docto": a.op_docto,
                                  "item": op.item if op else None,
                                  "horas_requeridas": horas_req})
            horas_restantes -= horas_req
        else:
            en_riesgo.append({"asignacion_id": a.id, "op_docto": a.op_docto,
                               "item": op.item if op else None,
                               "horas_requeridas": horas_req,
                               "horas_disponibles": horas_restantes})

    return {
        "alcanzables": alcanzables,
        "en_riesgo": en_riesgo,
        "horas_disponibles": cap.horas_disponibles_semana,
        "horas_asignadas": cap.horas_asignadas,
        "sobrecargada": cap.sobrecargada,
    }
