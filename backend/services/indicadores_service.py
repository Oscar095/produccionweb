"""
Cálculos centralizados de los indicadores de planta:
Tasa de Servicio, Disponibilidad, Eficiencia, Calidad y OEE (compuesto = D×R×Q).

Cada función recibe (db, inicio, fin, maquina_id=None) y devuelve el valor
global del período además del desglose por máquina.

Regla horaria de planta — Eficiencia y Disponibilidad comparten la MISMA base
por máquina (vía _actividad_por_maquina): SOLO los días que la máquina trabajó
según dbo.registro_produccion. Horas operativas de cada día trabajado:
  Lun     → HORAS_LUNES (18 h, producción arranca 06:00)
  Mar-Vie → 24 h/día
  Sáb     → HORAS_SABADO (8 h)
  Dom     → HORAS_DOMINGO_SI_TRABAJA (8 h) SOLO si la máquina registró producción

Las paradas de mantenimiento de Disponibilidad se acotan a esos días trabajados
(_horas_parada_en_dias). working_hours.operative_hours_between sigue en uso para
los cálculos de Gantt/planeación (L-V 24h). No se modifica.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta, date
from typing import Optional, List, Tuple

from sqlalchemy import func, cast, String
from sqlalchemy.orm import Session
from sqlalchemy import Date as SADate

from models.production import OpNumero, RegistroProduccion, Maquina
from models.maintenance import SolicitudMantenimiento
from schemas.production import (
    MaquinaAvailabilityOut, MaquinaEficienciaOut, MaquinaCalidadOut,
    MaquinaOEEOut,
)
from services.working_hours import operative_hours_between

# Horario oficial de planta
HORA_INICIO_LUNES: int = 6        # producción arranca a las 06:00 los lunes
HORAS_LUNES: float = 24.0 - HORA_INICIO_LUNES   # = 18h
HORAS_SABADO: float = 8.0
HORAS_DOMINGO_SI_TRABAJA: float = 8.0

# Estados de dbo.solicitudes_mantenimiento (dbo.estados_solicitudes_mantenimiento)
ESTADO_EN_PROCESO: int = 1
ESTADO_SOLUCIONADO: int = 2
ESTADO_CANCELADO: int = 3


def _horas_operativas_dia(d: date, tuvo_registros: bool) -> float:
    """Lunes → 18h (06:00-24:00), Mar-Vie → 24h, Sáb → 8h, Dom → 8h si trabajó."""
    wd = d.weekday()
    if wd == 0:
        return HORAS_LUNES
    if wd <= 4:
        return 24.0
    if wd == 5:
        return HORAS_SABADO
    return HORAS_DOMINGO_SI_TRABAJA if tuvo_registros else 0.0


# ── helpers internos ────────────────────────────────────────

def _horas_parada_en_dias(
    fecha_ini: datetime, cierre: datetime, dias_validos: set[date]
) -> float:
    """
    Horas L-V de [fecha_ini, cierre) que caen en días presentes en `dias_validos`.
    Variante de operative_hours_between que además exige que la máquina haya
    trabajado ese día (día con registro de producción), para no descontar paradas
    de días que no entran en la base de disponibilidad.
    """
    if cierre <= fecha_ini:
        return 0.0
    total = 0.0
    cursor = fecha_ini
    while cursor < cierre:
        end_of_day = (cursor + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        chunk_end = min(cierre, end_of_day)
        d = cursor.date()
        if d.weekday() <= 4 and d in dias_validos:   # L-V y la máquina trabajó ese día
            total += (chunk_end - cursor).total_seconds() / 3600.0
        cursor = chunk_end
    return total


def _fin_del_dia(dt: datetime) -> datetime:
    """00:00 del día siguiente (fin exclusivo del día calendario de `dt`)."""
    return (dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def _horas_parada_por_maquina(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
    dias_validos: Optional[dict[int, set[date]]] = None,
) -> dict[int, float]:
    """
    Horas hábiles (L-V) de parada por máquina dentro de [inicio, fin]. Cuenta
    sólo tickets cuyo inicio cae en el período (regla D; se descartan los arrastrados).

    Cierre por ticket (evita que datos incompletos de AppSheet inflen la parada):
      - Cancelado (estado 3): se descarta — no es una parada real.
      - fecha_solucion presente: se usa (acotada a `fin`).
      - Sin fecha_solucion + En proceso (estado 1): sigue abierto → se cuenta hasta `fin`.
      - Sin fecha_solucion + cerrado sin fecha (Solucionado u otro): se cierra al FIN
        DEL DÍA de inicio, no se estira hasta fin de mes.

    Si se pasa `dias_validos` (fechas trabajadas por máquina), las paradas se
    acotan a esos días — así numerador y denominador de disponibilidad comparten
    la misma base de días.
    """
    q = db.query(
        SolicitudMantenimiento.row_maquina,
        SolicitudMantenimiento.fecha,
        SolicitudMantenimiento.fecha_solucion,
        SolicitudMantenimiento.row_estado,
    ).filter(
        SolicitudMantenimiento.fecha >= inicio,
        SolicitudMantenimiento.fecha <= fin,
    )
    if maquina_id is not None:
        q = q.filter(SolicitudMantenimiento.row_maquina == maquina_id)

    out: dict[int, float] = {}
    for row_maquina, fecha_ini, fecha_fin, row_estado in q.all():
        if row_maquina is None or fecha_ini is None:
            continue
        if row_estado == ESTADO_CANCELADO:
            continue
        if fecha_fin is not None:
            cierre = min(fecha_fin, fin)
        elif row_estado == ESTADO_EN_PROCESO:
            cierre = fin                                    # genuinamente abierto
        else:
            cierre = min(_fin_del_dia(fecha_ini), fin)      # cerrado sin fecha → fin del día
        if cierre <= fecha_ini:
            continue
        if dias_validos is not None:
            horas = _horas_parada_en_dias(
                fecha_ini, cierre, dias_validos.get(row_maquina, set())
            )
        else:
            horas = operative_hours_between(fecha_ini, cierre)
        out[row_maquina] = out.get(row_maquina, 0.0) + horas
    return out


def _actividad_por_maquina(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> dict[int, tuple[int, float, set[date]]]:
    """
    Por cada máquina con registros en el período devuelve
    (días, horas_operativas, fechas_trabajadas).
    Días: conteo de días-calendario distintos con producción (incluye S/D si trabajó).
    Horas: suma aplicando _horas_operativas_dia — L-V 24h, Sáb 8h, Dom 8h si trabajó.
    Fechas: conjunto de días-calendario con producción (base común para Eficiencia y
    Disponibilidad, y para acotar las paradas a los días que la máquina trabajó).
    """
    q = db.query(
        RegistroProduccion.maquina,
        cast(RegistroProduccion.fecha, SADate).label("fecha_dia"),
    ).filter(
        RegistroProduccion.fecha >= inicio,
        RegistroProduccion.fecha <= fin,
    )
    if maquina_id is not None:
        q = q.filter(RegistroProduccion.maquina == maquina_id)

    horas: dict[int, float] = {}
    fechas: dict[int, set[date]] = {}
    for mid, fecha_dia in q.distinct().all():
        if mid is None or fecha_dia is None:
            continue
        d = fecha_dia if isinstance(fecha_dia, date) else fecha_dia.date()
        fechas.setdefault(mid, set()).add(d)
        horas[mid] = horas.get(mid, 0.0) + _horas_operativas_dia(d, True)

    return {mid: (len(fechas[mid]), horas[mid], fechas[mid]) for mid in fechas}


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
    from models.maintenance import EstadoMaquina
    return (
        db.query(Maquina)
        .join(EstadoMaquina, EstadoMaquina.Id == Maquina.estado)
        .filter(
            Maquina.Id.in_(ids),
            func.lower(cast(EstadoMaquina.estado_descripcion, String(200))) != 'no disponible',
        )
        .all()
    )


# ── Disponibilidad ──────────────────────────────────────────

def compute_disponibilidad(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> Tuple[float, List[MaquinaAvailabilityOut], float, float]:
    """
    Disponibilidad = (horas_operativas − horas_parada) / horas_operativas, por máquina.

    Base = SOLO los días que la máquina trabajó según el reporte de producción
    (la MISMA base que Eficiencia, vía _actividad_por_maquina): L-V 18/24h, Sáb 8h,
    Dom 8h si trabajó. Las paradas de mantenimiento se acotan a esos mismos días, de
    modo que numerador y denominador comparten la base de días.

    Una máquina sin producción en el período no tiene base y se omite (queda alineada
    con el universo de Eficiencia/Calidad). Limitación: un paro en un día con 0
    producción no se refleja aquí — para esos outages de día completo el instrumento
    es el Pareto de paradas, no este KPI.

    Devuelve (valor_global_pct, por_maquina, horas_disp_total, horas_parada_total).
    """
    actividad = _actividad_por_maquina(db, inicio, fin, maquina_id)
    dias_validos = {mid: info[2] for mid, info in actividad.items()}
    paradas = _horas_parada_por_maquina(db, inicio, fin, maquina_id, dias_validos)
    maquinas = _maquinas_universo(db, inicio, fin, maquina_id)

    por_maquina: list[MaquinaAvailabilityOut] = []
    horas_disp_total = 0.0
    horas_parada_total = 0.0

    for m in maquinas:
        info = actividad.get(m.Id)
        if not info:
            continue
        dias_m, horas_op, _ = info
        if horas_op <= 0:
            continue
        horas_parada = min(paradas.get(m.Id, 0.0), horas_op)
        disp_pct = round(max(0.0, (horas_op - horas_parada) / horas_op) * 100, 1)
        por_maquina.append(MaquinaAvailabilityOut(
            maquina_id=m.Id,
            maquina_nombre=m.nombre,
            dias_trabajados=dias_m,
            horas_disponibles=round(horas_op, 1),
            horas_parada=round(horas_parada, 1),
            disponibilidad_pct=disp_pct,
        ))
        horas_disp_total += horas_op
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
    producción real    = SUM(produccion + clase_b + desecho)
    producción teórica = capacidad_hora × horas_operativas

    horas_operativas: L-V → 24h, Sáb → 8h, Dom → 8h si registró producción.
    Base = solo días con registros (no penaliza máquinas inactivas parte del mes).
    Paradas NO se descuentan (ya afectan Disponibilidad en el OEE).
    Máquinas con calcula_capacidad=False se excluyen.
    """
    actividad = _actividad_por_maquina(db, inicio, fin, maquina_id)
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

    por_maquina: list[MaquinaEficienciaOut] = []
    produccion_real_total = 0
    produccion_teorica_total = 0.0

    for m in maquinas:
        if not bool(getattr(m, "calcula_capacidad", True)):
            continue
        cap = m.capacidad_hora or 0
        if cap <= 0:
            continue
        info = actividad.get(m.Id)
        if not info:
            continue
        dias_m, horas_operativas, _ = info
        if horas_operativas <= 0:
            continue
        prod_teorica = cap * horas_operativas
        prod_real = int(prod_por_maquina.get(m.Id, 0) or 0)
        ef_pct = round(prod_real / prod_teorica * 100, 1) if prod_teorica > 0 else 0.0
        por_maquina.append(MaquinaEficienciaOut(
            maquina_id=m.Id,
            maquina_nombre=m.nombre,
            dias_trabajados=dias_m,
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

# Peso promedio de una unidad de desecho, para normalizar Kg → unidades.
# 1 unidad ≈ 8 gr  →  1 Kg = 1000 gr = 125 unidades.
GRAMOS_POR_UNIDAD_DESECHO = 8.0


def compute_calidad(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> Tuple[float, List[MaquinaCalidadOut], int, int]:
    """
    Calidad = SUM(produccion) / SUM(produccion + clase_b + desecho).

    Normalización de unidades: `produccion` (buena) y `clase_b` están en
    unidades, pero `desecho` está en Kg. Se convierte el desecho a unidades
    asumiendo un peso promedio de 8 gr por unidad (1 Kg = 125 und) antes de
    sumarlo, para que el total quede en una sola unidad de medida.
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

    # Exclude "No Disponible" machines
    disponibles: set[int] = set(ids)
    if ids:
        from models.maintenance import EstadoMaquina
        disponibles = {
            row[0] for row in (
                db.query(Maquina.Id)
                .join(EstadoMaquina, EstadoMaquina.Id == Maquina.estado)
                .filter(
                    Maquina.Id.in_(ids),
                    func.lower(cast(EstadoMaquina.estado_descripcion, String(200))) != 'no disponible',
                )
                .all()
            )
        }

    por_maquina: list[MaquinaCalidadOut] = []
    buena_total = 0
    produccion_total = 0
    for mid, buena, clase_b, desecho in rows:
        if mid is None:
            continue
        if mid not in disponibles:
            continue
        buena = int(buena or 0)
        clase_b = int(clase_b or 0)
        # desecho llega en Kg → normalizar a unidades (1 und ≈ 8 gr)
        desecho_kg = float(desecho or 0)
        desecho_und = round(desecho_kg * 1000.0 / GRAMOS_POR_UNIDAD_DESECHO)
        total = buena + clase_b + desecho_und
        if total <= 0:
            continue
        calidad_pct = round(buena / total * 100, 1)
        por_maquina.append(MaquinaCalidadOut(
            maquina_id=mid,
            maquina_nombre=nombres.get(mid),
            produccion_buena=buena,
            clase_b=clase_b,
            desecho=desecho_und,
            desecho_kg=round(desecho_kg, 2),
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


# ── OEE (Disponibilidad × Rendimiento × Calidad) ────────────

def compute_oee(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> Tuple[float, List[MaquinaOEEOut], float, float, float]:
    """
    OEE = Disponibilidad × Rendimiento (Eficiencia) × Calidad.

    - Global del período = producto de los tres globales de planta. Es idéntico al
      que expone /api/production/equipment-oee (Dashboard), para no tener dos números
      de OEE distintos en el sistema.
    - Por máquina = producto de los tres pilares, SOLO para máquinas presentes en los
      tres (intersección). Una máquina sin base en cualquiera de los pilares
      (sin producción, sin capacidad, "No Disponible") se omite del OEE por máquina.

    Devuelve (oee_global_pct, por_maquina, disp_global, rend_global, cal_global).
    """
    d_glob, d_list, _, _ = compute_disponibilidad(db, inicio, fin, maquina_id)
    r_glob, r_list, _, _ = compute_eficiencia(db, inicio, fin, maquina_id)
    q_glob, q_list, _, _ = compute_calidad(db, inicio, fin, maquina_id)

    valor_global = round((d_glob / 100.0) * (r_glob / 100.0) * (q_glob / 100.0) * 100, 1)

    d_map = {m.maquina_id: m for m in d_list}
    r_map = {m.maquina_id: m for m in r_list}
    q_map = {m.maquina_id: m for m in q_list}
    comunes = set(d_map) & set(r_map) & set(q_map)

    por_maquina: list[MaquinaOEEOut] = []
    for mid in comunes:
        d = d_map[mid].disponibilidad_pct
        r = r_map[mid].eficiencia_pct
        q = q_map[mid].calidad_pct
        oee_pct = round((d / 100.0) * (r / 100.0) * (q / 100.0) * 100, 1)
        por_maquina.append(MaquinaOEEOut(
            maquina_id=mid,
            maquina_nombre=d_map[mid].maquina_nombre,
            disponibilidad_pct=d,
            rendimiento_pct=r,
            calidad_pct=q,
            oee_pct=oee_pct,
        ))

    por_maquina.sort(key=lambda x: x.oee_pct)
    return valor_global, por_maquina, d_glob, r_glob, q_glob


# ── Tasa de Servicio ────────────────────────────────────────

def sync_completaciones(db: Session) -> None:
    """
    Detecta OPs (tipo 1430K.ex) que pasaron a completas (cant_consumida >= cantidad)
    del año en curso y no están en planeacion.op_cierre. Las inserta usando la fecha
    del último registro de producción como fecha_completada (más precisa que hoy).
    """
    from models.planning import OpCierre
    hoy = date.today()
    anio_inicio = date(hoy.year, 1, 1)

    registradas = db.query(OpCierre.op_docto).subquery()
    nuevas = (
        db.query(OpNumero)
        .filter(
            OpNumero.tipo_inv.like('%1430K.ex%'),
            OpNumero.f851_fecha_terminacion >= anio_inicio,
            OpNumero.cant_consumida >= OpNumero.cantidad,
            ~OpNumero.docto.in_(registradas),
        )
        .all()
    )
    if not nuevas:
        return

    # Fecha del último registro de producción por OP (más precisa que hoy)
    doctos_nuevos = [op.docto for op in nuevas]
    last_prod_rows = (
        db.query(RegistroProduccion.numero_op, func.max(RegistroProduccion.fecha))
        .filter(RegistroProduccion.numero_op.in_(doctos_nuevos))
        .group_by(RegistroProduccion.numero_op)
        .all()
    )
    last_prod_date: dict[int, date] = {}
    for num_op, max_fecha in last_prod_rows:
        if max_fecha is not None:
            d = max_fecha.date() if hasattr(max_fecha, 'date') else max_fecha
            last_prod_date[num_op] = d

    for op in nuevas:
        fp = op.f851_fecha_terminacion
        fecha_prom = fp.date() if hasattr(fp, 'date') else fp
        fecha_compl = last_prod_date.get(op.docto, hoy)
        db.add(OpCierre(
            op_docto=op.docto,
            fecha_prometida=fecha_prom,
            fecha_completada=fecha_compl,
            fue_tarde=fecha_compl > fecha_prom,
            cantidad=op.cantidad,
            cant_consumida=op.cant_consumida,
        ))
    db.commit()


def compute_tasa_servicio(
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int] = None,
) -> Tuple[float, int, int]:
    """
    Tasa de Servicio = (1 - atrasadas / total) × 100.

    Atrasadas = incompletas vencidas + completadas tarde (registradas en planeacion.op_cierre).
    Devuelve (valor_pct, total, atrasadas).
    """
    from models.planning import OpCierre, Asignacion
    hoy = datetime.now()
    inicio_d = inicio.date() if isinstance(inicio, datetime) else inicio
    fin_d = fin.date() if isinstance(fin, datetime) else fin

    q_total = db.query(func.count(OpNumero.Id)).filter(
        OpNumero.tipo_inv.like('%1430K.ex%'),
        OpNumero.f851_fecha_terminacion >= inicio_d,
        OpNumero.f851_fecha_terminacion <= fin_d,
    )
    if maquina_id is not None:
        q_total = q_total.join(
            Asignacion, Asignacion.op_docto == OpNumero.docto, isouter=False
        ).filter(Asignacion.maquina_id == maquina_id, Asignacion.suspendida == False)
    total = q_total.scalar() or 0

    # Incompletas vencidas
    q_atr = db.query(func.count(OpNumero.Id)).filter(
        OpNumero.tipo_inv.like('%1430K.ex%'),
        OpNumero.f851_fecha_terminacion >= inicio_d,
        OpNumero.f851_fecha_terminacion <= fin_d,
        OpNumero.f851_fecha_terminacion < hoy.date(),
        OpNumero.cant_consumida < OpNumero.cantidad,
    )
    if maquina_id is not None:
        q_atr = q_atr.join(
            Asignacion, Asignacion.op_docto == OpNumero.docto, isouter=False
        ).filter(Asignacion.maquina_id == maquina_id, Asignacion.suspendida == False)
    incompletas = q_atr.scalar() or 0

    # Completadas tarde (registradas en planeacion.op_cierre)
    q_tard = db.query(func.count(OpCierre.op_docto)).filter(
        OpCierre.fecha_prometida >= inicio_d,
        OpCierre.fecha_prometida <= fin_d,
        OpCierre.fue_tarde == True,
    )
    if maquina_id is not None:
        q_tard = q_tard.join(
            Asignacion, Asignacion.op_docto == OpCierre.op_docto, isouter=False
        ).filter(Asignacion.maquina_id == maquina_id, Asignacion.suspendida == False)
    tard_compl = q_tard.scalar() or 0

    atrasadas = incompletas + tard_compl
    tasa = round((1 - atrasadas / total) * 100, 1) if total > 0 else 100.0
    return tasa, total, atrasadas


# ── Resolución de máquina por OP (ruta como base, producción real prevalece) ──

def _maquina_id_por_ruta(db: Session) -> dict[str, tuple[int, str]]:
    """
    nombre_ruta.strip() -> (maquina_id, maquina_nombre).
    Una máquina representativa por ruta: se prefiere estado disponible y,
    a igualdad, el de menor Id.
    """
    from models.planning import RutaSiesa
    from models.maintenance import EstadoMaquina

    rutas = {r.id: r.nombre_ruta for r in db.query(RutaSiesa).all()}
    estados = {
        e.Id: (e.estado_descripcion or "").strip().lower()
        for e in db.query(EstadoMaquina).all()
    }
    maquinas = db.query(Maquina).filter(Maquina.rutas_siesa_id.isnot(None)).all()
    # Orden: disponibles primero, luego menor Id → la "primera" por ruta es la elegida.
    maquinas.sort(key=lambda m: (estados.get(m.estado, "") == "no disponible", m.Id))

    out: dict[str, tuple[int, str]] = {}
    for m in maquinas:
        nombre_ruta = rutas.get(m.rutas_siesa_id)
        if not nombre_ruta:
            continue
        key = nombre_ruta.strip()
        if key and key not in out:
            out[key] = (m.Id, m.nombre)
    return out


def resolver_maquina_por_op(db: Session, ops: list) -> dict[int, int]:
    """
    op_docto -> maquina_id.
    Base: máquina de la ruta del OP
    (OpNumero.ruta_op -> RutaSiesa.nombre_ruta -> Maquina.rutas_siesa_id).
    La máquina con mayor producción real registrada prevalece sobre la base de ruta.
    """
    ruta_map = _maquina_id_por_ruta(db)

    res: dict[int, int] = {}
    for op in ops:
        hit = ruta_map.get((op.ruta_op or "").strip())
        if hit:
            res[op.docto] = hit[0]

    doctos = [op.docto for op in ops]
    if doctos:
        prod_rows = (
            db.query(
                RegistroProduccion.numero_op,
                RegistroProduccion.maquina,
                func.sum(RegistroProduccion.produccion).label("total_prod"),
            )
            .filter(RegistroProduccion.numero_op.in_(doctos))
            .group_by(RegistroProduccion.numero_op, RegistroProduccion.maquina)
            .all()
        )
        best: dict[int, tuple[int, int]] = {}   # op_docto -> (maquina_id, max_prod)
        for num_op, maq_id, total_prod in prod_rows:
            tp = int(total_prod or 0)
            if num_op not in best or tp > best[num_op][1]:
                best[num_op] = (maq_id, tp)
        for num_op, (maq_id, _) in best.items():
            res[num_op] = maq_id

    return res


# ── Tasa de Servicio por máquina (resuelta por ruta, sin N+1) ──

def compute_tasa_servicio_por_maquina(
    db: Session,
    inicio: datetime,
    fin: datetime,
) -> list[dict]:
    """
    Devuelve lista [{maquina_id, total, atrasadas}] agrupada por máquina,
    resolviendo la máquina de cada OP por su ruta (la producción real prevalece).
    Las OPs sin máquina resoluble se agrupan en maquina_id = 0 ("Sin asignar").
    Cada OP cuenta para exactamente una máquina, así que la suma por máquina
    cuadra con el total mensual.
    Atrasadas = incompletas vencidas + completadas tarde (planeacion.op_cierre).
    """
    from models.planning import OpCierre

    hoy = datetime.now().date()
    inicio_d = inicio.date() if isinstance(inicio, datetime) else inicio
    fin_d = fin.date() if isinstance(fin, datetime) else fin

    ops = (
        db.query(OpNumero)
        .filter(
            OpNumero.tipo_inv.like('%1430K.ex%'),
            OpNumero.f851_fecha_terminacion >= inicio_d,
            OpNumero.f851_fecha_terminacion <= fin_d,
        )
        .all()
    )
    if not ops:
        return []

    maq_por_op = resolver_maquina_por_op(db, ops)

    doctos = [op.docto for op in ops]
    tarde_doctos = {
        c.op_docto
        for c in db.query(OpCierre).filter(
            OpCierre.op_docto.in_(doctos),
            OpCierre.fecha_prometida >= inicio_d,
            OpCierre.fecha_prometida <= fin_d,
            OpCierre.fue_tarde == True,  # noqa: E712
        ).all()
    }

    agg: dict[int, dict] = {}   # maquina_id (0 = sin asignar) -> {total, atrasadas}
    for op in ops:
        mid = maq_por_op.get(op.docto, 0) or 0
        bucket = agg.setdefault(mid, {"total": 0, "atrasadas": 0})
        bucket["total"] += 1

        fp = op.f851_fecha_terminacion
        fecha_prom = fp.date() if hasattr(fp, "date") else fp
        incompleta_vencida = (
            fecha_prom is not None
            and fecha_prom < hoy
            and (op.cant_consumida or 0) < (op.cantidad or 0)
        )
        if incompleta_vencida or op.docto in tarde_doctos:
            bucket["atrasadas"] += 1

    return [
        {"maquina_id": mid, "total": v["total"], "atrasadas": v["atrasadas"]}
        for mid, v in agg.items()
        if v["total"] > 0
    ]


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
