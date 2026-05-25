"""
Cálculos centralizados de los 4 indicadores de planta:
Tasa de Servicio, Disponibilidad, Eficiencia, Calidad.

Cada función recibe (db, inicio, fin, maquina_id=None) y devuelve el valor
global del período además del desglose por máquina. La base horaria es
'horas hábiles L-V' (operative_hours_between) — la planta opera 24h L-V y
sábado/domingo se excluyen.

Estos helpers los consumen tanto los endpoints históricos
(/api/production/equipment-*) como el nuevo router /api/indicadores/*.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta, date
from typing import Optional, List, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.production import OpNumero, RegistroProduccion, Maquina
from models.maintenance import SolicitudMantenimiento
from schemas.production import (
    MaquinaAvailabilityOut, MaquinaEficienciaOut, MaquinaCalidadOut,
)
from services.working_hours import operative_hours_between


# ── helpers internos ────────────────────────────────────────

def _horas_parada_por_maquina(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> dict[int, float]:
    """
    Horas hábiles (L-V) de parada por máquina dentro de [inicio, fin]. Cuenta
    sólo tickets cuyo inicio cae en el período (se descartan los arrastrados);
    tickets aún abiertos se cuentan hasta `fin`.
    """
    q = db.query(
        SolicitudMantenimiento.row_maquina,
        SolicitudMantenimiento.fecha,
        SolicitudMantenimiento.fecha_solucion,
    ).filter(
        SolicitudMantenimiento.fecha >= inicio,
        SolicitudMantenimiento.fecha <= fin,
    )
    if maquina_id is not None:
        q = q.filter(SolicitudMantenimiento.row_maquina == maquina_id)

    out: dict[int, float] = {}
    for row_maquina, fecha_ini, fecha_fin in q.all():
        if row_maquina is None or fecha_ini is None:
            continue
        cierre = min(fecha_fin or fin, fin)
        if cierre <= fecha_ini:
            continue
        out[row_maquina] = out.get(row_maquina, 0.0) + operative_hours_between(fecha_ini, cierre)
    return out


def _nombres_maquinas(db: Session, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    return {
        m.Id: m.nombre
        for m in db.query(Maquina.Id, Maquina.nombre).filter(Maquina.Id.in_(ids)).all()
    }


def _maquinas_universo(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> list[Maquina]:
    """
    Universo de máquinas a evaluar: las que tuvieron actividad (registros de
    producción o tickets de mantenimiento) dentro de [inicio, fin]. Esto evita
    que máquinas inactivas/obsoletas inflen el global con 100% disp. + 0% efic.
    Si se pasa maquina_id, devuelve esa máquina sin importar actividad.
    """
    if maquina_id is not None:
        return db.query(Maquina).filter(Maquina.Id == maquina_id).all()

    ids_prod = {
        mid for (mid,) in db.query(RegistroProduccion.maquina)
        .filter(RegistroProduccion.fecha >= inicio, RegistroProduccion.fecha <= fin)
        .distinct().all()
        if mid is not None
    }
    ids_paradas = {
        mid for (mid,) in db.query(SolicitudMantenimiento.row_maquina)
        .filter(SolicitudMantenimiento.fecha >= inicio, SolicitudMantenimiento.fecha <= fin)
        .distinct().all()
        if mid is not None
    }
    ids = ids_prod | ids_paradas
    if not ids:
        return []
    return db.query(Maquina).filter(Maquina.Id.in_(ids)).all()


# ── Disponibilidad ──────────────────────────────────────────

def compute_disponibilidad(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> Tuple[float, List[MaquinaAvailabilityOut], float, float]:
    """
    Disponibilidad = (horas_hábiles − horas_parada) / horas_hábiles.
    Devuelve (valor_global_pct, por_maquina, horas_disp_total, horas_parada_total).
    """
    horas_disp = operative_hours_between(inicio, fin)
    paradas = _horas_parada_por_maquina(db, inicio, fin, maquina_id)
    maquinas = _maquinas_universo(db, inicio, fin, maquina_id)

    por_maquina: list[MaquinaAvailabilityOut] = []
    horas_disp_total = 0.0
    horas_parada_total = 0.0

    if horas_disp <= 0:
        return 0.0, [], 0.0, 0.0

    # Días hábiles transcurridos = horas_disp / 24 (informativo)
    dias_habiles = round(horas_disp / 24.0)

    for m in maquinas:
        horas_parada = min(paradas.get(m.Id, 0.0), horas_disp)
        disp_pct = round(max(0.0, (horas_disp - horas_parada) / horas_disp) * 100, 1)
        por_maquina.append(MaquinaAvailabilityOut(
            maquina_id=m.Id,
            maquina_nombre=m.nombre,
            dias_trabajados=dias_habiles,
            horas_disponibles=round(horas_disp, 1),
            horas_parada=round(horas_parada, 1),
            disponibilidad_pct=disp_pct,
        ))
        horas_disp_total += horas_disp
        horas_parada_total += horas_parada

    por_maquina.sort(key=lambda x: x.disponibilidad_pct)
    valor_global = (
        round((horas_disp_total - horas_parada_total) / horas_disp_total * 100, 1)
        if horas_disp_total > 0 else 0.0
    )
    return valor_global, por_maquina, horas_disp_total, horas_parada_total


# ── Eficiencia (Rendimiento) ────────────────────────────────

def compute_eficiencia(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> Tuple[float, List[MaquinaEficienciaOut], int, float]:
    """
    Eficiencia = producción real / producción teórica.
    producción real = SUM(produccion + clase_b + desecho)
    producción teórica = capacidad_hora × (horas_hábiles − horas_parada)
    """
    horas_disp = operative_hours_between(inicio, fin)
    if horas_disp <= 0:
        return 0.0, [], 0, 0.0

    paradas = _horas_parada_por_maquina(db, inicio, fin, maquina_id)
    maquinas = _maquinas_universo(db, inicio, fin, maquina_id)

    q = db.query(
        RegistroProduccion.maquina,
        func.sum(
            func.coalesce(RegistroProduccion.produccion, 0)
            + func.coalesce(RegistroProduccion.clase_b, 0)
            + func.coalesce(RegistroProduccion.desecho, 0)
        ),
    ).filter(RegistroProduccion.fecha >= inicio, RegistroProduccion.fecha <= fin)
    if maquina_id is not None:
        q = q.filter(RegistroProduccion.maquina == maquina_id)
    prod_por_maquina = dict(q.group_by(RegistroProduccion.maquina).all())

    dias_habiles = round(horas_disp / 24.0)

    por_maquina: list[MaquinaEficienciaOut] = []
    produccion_real_total = 0
    produccion_teorica_total = 0.0

    for m in maquinas:
        # Excluir máquinas marcadas como "no calcular capacidad" (p. ej. máquinas
        # auxiliares, mantenimiento o equipos que no producen unidades nominales).
        if not bool(getattr(m, "calcula_capacidad", True)):
            continue
        cap = m.capacidad_hora or 0
        if cap <= 0:
            continue
        horas_parada = min(paradas.get(m.Id, 0.0), horas_disp)
        horas_operativas = max(horas_disp - horas_parada, 0.0)
        if horas_operativas <= 0:
            continue
        prod_teorica = cap * horas_operativas
        prod_real = int(prod_por_maquina.get(m.Id, 0) or 0)
        ef_pct = round(prod_real / prod_teorica * 100, 1) if prod_teorica > 0 else 0.0
        por_maquina.append(MaquinaEficienciaOut(
            maquina_id=m.Id,
            maquina_nombre=m.nombre,
            dias_trabajados=dias_habiles,
            horas_operativas=round(horas_operativas, 1),
            capacidad_hora=cap,
            produccion_real=prod_real,
            produccion_teorica=round(prod_teorica, 1),
            eficiencia_pct=ef_pct,
        ))
        produccion_real_total += prod_real
        produccion_teorica_total += prod_teorica

    por_maquina.sort(key=lambda x: x.eficiencia_pct)
    valor_global = (
        round(produccion_real_total / produccion_teorica_total * 100, 1)
        if produccion_teorica_total > 0 else 0.0
    )
    return valor_global, por_maquina, produccion_real_total, produccion_teorica_total


# ── Calidad ─────────────────────────────────────────────────

def compute_calidad(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> Tuple[float, List[MaquinaCalidadOut], int, int]:
    """
    Calidad = SUM(produccion) / SUM(produccion + clase_b + desecho).
    """
    q = db.query(
        RegistroProduccion.maquina,
        func.sum(func.coalesce(RegistroProduccion.produccion, 0)),
        func.sum(func.coalesce(RegistroProduccion.clase_b, 0)),
        func.sum(func.coalesce(RegistroProduccion.desecho, 0)),
    ).filter(RegistroProduccion.fecha >= inicio, RegistroProduccion.fecha <= fin)
    if maquina_id is not None:
        q = q.filter(RegistroProduccion.maquina == maquina_id)
    rows = q.group_by(RegistroProduccion.maquina).all()

    ids = [r[0] for r in rows if r[0] is not None]
    nombres = _nombres_maquinas(db, ids)

    por_maquina: list[MaquinaCalidadOut] = []
    buena_total = 0
    produccion_total = 0
    for mid, buena, clase_b, desecho in rows:
        if mid is None:
            continue
        buena = int(buena or 0)
        clase_b = int(clase_b or 0)
        desecho = int(desecho or 0)
        total = buena + clase_b + desecho
        if total <= 0:
            continue
        calidad_pct = round(buena / total * 100, 1)
        por_maquina.append(MaquinaCalidadOut(
            maquina_id=mid,
            maquina_nombre=nombres.get(mid),
            produccion_buena=buena,
            clase_b=clase_b,
            desecho=desecho,
            produccion_total=total,
            calidad_pct=calidad_pct,
        ))
        buena_total += buena
        produccion_total += total

    por_maquina.sort(key=lambda x: x.calidad_pct)
    valor_global = (
        round(buena_total / produccion_total * 100, 1)
        if produccion_total > 0 else 0.0
    )
    return valor_global, por_maquina, buena_total, produccion_total


# ── Tasa de Servicio ────────────────────────────────────────

def compute_tasa_servicio(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> Tuple[float, int, int]:
    """
    Tasa de Servicio = (1 - atrasadas / total) × 100.

    Universo: OPs con f851_fecha_terminacion en [inicio, fin]. Atrasadas: OPs
    cuya fecha de terminación ya pasó (< hoy) y su cant_consumida < cantidad.

    Devuelve (valor_pct, total, atrasadas).
    """
    hoy = datetime.now()
    inicio_d = inicio.date() if isinstance(inicio, datetime) else inicio
    fin_d = fin.date() if isinstance(fin, datetime) else fin

    # Total OPs comprometidas en el período.
    q_total = db.query(func.count(OpNumero.Id)).filter(
        OpNumero.f851_fecha_terminacion >= inicio_d,
        OpNumero.f851_fecha_terminacion <= fin_d,
    )
    if maquina_id is not None:
        # Filtro por máquina: usa el join con Asignacion (planeación)
        from models.planning import Asignacion
        q_total = q_total.join(
            Asignacion, Asignacion.op_docto == OpNumero.docto, isouter=False
        ).filter(Asignacion.maquina_id == maquina_id, Asignacion.suspendida == False)
    total = q_total.scalar() or 0

    q_atr = db.query(func.count(OpNumero.Id)).filter(
        OpNumero.f851_fecha_terminacion >= inicio_d,
        OpNumero.f851_fecha_terminacion <= fin_d,
        OpNumero.f851_fecha_terminacion < hoy.date(),
        OpNumero.cant_consumida < OpNumero.cantidad,
    )
    if maquina_id is not None:
        from models.planning import Asignacion
        q_atr = q_atr.join(
            Asignacion, Asignacion.op_docto == OpNumero.docto, isouter=False
        ).filter(Asignacion.maquina_id == maquina_id, Asignacion.suspendida == False)
    atrasadas = q_atr.scalar() or 0

    tasa = round((1 - atrasadas / total) * 100, 1) if total > 0 else 100.0
    return tasa, total, atrasadas


# ── Iteración por semana del mes ────────────────────────────

def iter_semanas_mes(year: int, month: int) -> list[tuple[datetime, datetime, str]]:
    """
    Devuelve tuplas (inicio_lunes, fin_viernes, label) que cubren el mes en
    semanas L-V. Las semanas que se solapan parcialmente con el mes se
    recortan al inicio/fin del mes.
    """
    primer_dia = date(year, month, 1)
    ultimo_dia = date(year, month, monthrange(year, month)[1])

    # Lunes de la semana del primer día
    lunes = primer_dia - timedelta(days=primer_dia.weekday())

    out: list[tuple[datetime, datetime, str]] = []
    while lunes <= ultimo_dia:
        viernes = lunes + timedelta(days=4)
        ini = max(lunes, primer_dia)
        fin = min(viernes, ultimo_dia)
        ini_dt = datetime(ini.year, ini.month, ini.day, 0, 0, 0)
        fin_dt = datetime(fin.year, fin.month, fin.day, 23, 59, 59)
        # Etiqueta tipo "Sem 21 (18-22 May)"
        sem_num = lunes.isocalendar()[1]
        meses_corto = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
                       "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
        label = f"Sem {sem_num} ({ini.day:02d}-{fin.day:02d} {meses_corto[ini.month]})"
        out.append((ini_dt, fin_dt, label))
        lunes = lunes + timedelta(days=7)
    return out
