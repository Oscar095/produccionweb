"""
Tools expuestas al agente Koski IA (Anthropic Claude tool use).

Cada tool es una función Python que recibe la Session SQLAlchemy actual y
devuelve un dict JSON-serializable. Son read-only: no modifican datos.

ANTHROPIC_TOOLS se pasa a Claude para que conozca los tools disponibles.
dispatch_tool() resuelve name -> función y ejecuta.
"""
from __future__ import annotations

import statistics
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.production import Maquina, OpNumero, RegistroProduccion
from models.planning import Asignacion, ParadaProgramada
from services.gantt_service import get_gantt_data
from services.planning_engine import get_capacidad_semana, get_feasibility
from services.report_service import build_production_report
from services.working_hours import operative_hours_between


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _lunes_de_hoy() -> datetime:
    hoy = datetime.utcnow().date()
    lunes = hoy - timedelta(days=hoy.weekday())
    return datetime.combine(lunes, datetime.min.time())


def _parse_dt(value: Optional[str], default: Optional[datetime] = None) -> Optional[datetime]:
    if not value:
        return default
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return default


def _estado_op(cant: Optional[int], consumida: Optional[int]) -> str:
    c = cant or 0
    cons = consumida or 0
    if c == 0:
        return "Sin cantidad"
    if cons <= 0:
        return "Pendiente"
    if cons >= c:
        return "Completado"
    return "En proceso"


def _safe_div(num: float, den: float) -> Optional[float]:
    if den is None or den == 0:
        return None
    return num / den


# ─────────────────────────────────────────────────────────────
# Tool implementations — operativas (existentes)
# ─────────────────────────────────────────────────────────────

def tool_list_ordenes_produccion(
    db: Session,
    estado: Optional[str] = None,
    buscar: Optional[str] = None,
    fecha_entrega_desde: Optional[str] = None,
    fecha_entrega_hasta: Optional[str] = None,
    ordenar_por: Optional[str] = None,
    limit: int = 20,
    **_: Any,
) -> Dict[str, Any]:
    """Lista OPs con filtros (estado, búsqueda libre, rango de fecha de entrega)."""
    q = db.query(OpNumero)
    if buscar:
        like = f"%{buscar}%"
        filtros = [
            OpNumero.item.like(like),
            OpNumero.marca.like(like),
            OpNumero.ext1.like(like),
            OpNumero.ext2.like(like),
        ]
        if buscar.isdigit():
            filtros.append(OpNumero.docto == int(buscar))
        q = q.filter(or_(*filtros))

    desde_dt = _parse_dt(fecha_entrega_desde)
    hasta_dt = _parse_dt(fecha_entrega_hasta)
    if desde_dt:
        q = q.filter(OpNumero.f851_fecha_terminacion >= desde_dt)
    if hasta_dt:
        if hasta_dt.hour == 0 and hasta_dt.minute == 0 and hasta_dt.second == 0:
            hasta_dt = hasta_dt + timedelta(hours=23, minutes=59, seconds=59)
        q = q.filter(OpNumero.f851_fecha_terminacion <= hasta_dt)

    if ordenar_por == "fecha_entrega":
        q = q.order_by(OpNumero.f851_fecha_terminacion.asc())
    else:
        q = q.order_by(OpNumero.docto.desc())

    rows = q.limit(limit * 3).all()

    items = []
    vistos = set()
    for op in rows:
        if op.docto in vistos:
            continue
        vistos.add(op.docto)
        est = _estado_op(op.cantidad, op.cant_consumida)
        if estado and est.lower() != estado.lower():
            continue
        items.append({
            "op_docto": op.docto,
            "item": op.item,
            "marca": op.marca,
            "cantidad": op.cantidad,
            "cant_consumida": op.cant_consumida,
            "estado": est,
            "fecha_entrega": op.f851_fecha_terminacion.isoformat() if op.f851_fecha_terminacion else None,
        })
        if len(items) >= limit:
            break
    return {
        "total": len(items),
        "filtros_aplicados": {
            "estado": estado,
            "buscar": buscar,
            "fecha_entrega_desde": fecha_entrega_desde,
            "fecha_entrega_hasta": fecha_entrega_hasta,
            "ordenar_por": ordenar_por,
        },
        "ordenes": items,
    }


def tool_get_orden_detalle(db: Session, op_docto: int, **_: Any) -> Dict[str, Any]:
    """Detalle completo de una OP por número (`docto`)."""
    op = db.query(OpNumero).filter(OpNumero.docto == op_docto).first()
    if not op:
        return {"error": f"OP {op_docto} no encontrada"}
    asig = db.query(Asignacion).filter(Asignacion.op_docto == op_docto).first()
    maq = db.query(Maquina).filter(Maquina.Id == asig.maquina_id).first() if asig else None
    return {
        "op_docto": op.docto,
        "item": op.item,
        "marca": op.marca,
        "calibre": op.ext2,
        "cantidad": op.cantidad,
        "cant_consumida": op.cant_consumida,
        "estado": _estado_op(op.cantidad, op.cant_consumida),
        "fecha_entrega": op.f851_fecha_terminacion.isoformat() if op.f851_fecha_terminacion else None,
        "asignada_a_maquina": maq.nombre if maq else None,
        "fecha_inicio_plan": asig.fecha_inicio_plan.isoformat() if asig else None,
        "fecha_fin_plan": asig.fecha_fin_plan.isoformat() if asig else None,
        "suspendida": asig.suspendida if asig else None,
    }


def tool_get_kpis_produccion(db: Session, **_: Any) -> Dict[str, Any]:
    """KPIs globales: totales de OPs por estado y % completado."""
    ops = db.query(OpNumero).all()
    total = len({o.docto for o in ops})
    vistos: dict[int, OpNumero] = {}
    for op in ops:
        if op.docto not in vistos:
            vistos[op.docto] = op
    completadas = sum(1 for o in vistos.values() if (o.cant_consumida or 0) >= (o.cantidad or 1))
    en_proceso = sum(1 for o in vistos.values() if 0 < (o.cant_consumida or 0) < (o.cantidad or 1))
    pendientes = sum(1 for o in vistos.values() if (o.cant_consumida or 0) <= 0)
    asignadas = {a.op_docto for a in db.query(Asignacion.op_docto).filter(Asignacion.suspendida == False).all()}  # noqa: E712
    sin_asignar = sum(1 for o in vistos.values() if o.docto not in asignadas and (o.cant_consumida or 0) < (o.cantidad or 1))
    pct = round(completadas / total * 100, 1) if total else 0.0
    return {
        "total_ordenes": total,
        "completadas": completadas,
        "en_proceso": en_proceso,
        "pendientes": pendientes,
        "sin_asignar": sin_asignar,
        "pct_completado": pct,
    }


def tool_list_maquinas(db: Session, **_: Any) -> Dict[str, Any]:
    """Lista máquinas activas con su capacidad por hora y centro de costos."""
    maquinas = db.query(Maquina).all()
    items = []
    for m in maquinas:
        items.append({
            "maquina_id": m.Id,
            "nombre": m.nombre,
            "capacidad_hora": m.capacidad_hora,
            "centro_costos": m.centro_costos.centro if m.centro_costos else None,
        })
    return {"total": len(items), "maquinas": items}


def tool_get_planning_board(db: Session, maquina_id: Optional[int] = None, **_: Any) -> Dict[str, Any]:
    """Tablero Kanban de asignaciones activas agrupadas por máquina."""
    q = db.query(Asignacion).filter(Asignacion.suspendida == False)  # noqa: E712
    if maquina_id:
        q = q.filter(Asignacion.maquina_id == maquina_id)
    asignaciones = q.order_by(Asignacion.maquina_id, Asignacion.prioridad).all()

    doctos = [a.op_docto for a in asignaciones]
    ops = {}
    if doctos:
        for op in db.query(OpNumero).filter(OpNumero.docto.in_(doctos)).all():
            ops.setdefault(op.docto, op)

    maquinas = {m.Id: m for m in db.query(Maquina).all()}
    board: Dict[int, Dict[str, Any]] = {}
    for a in asignaciones:
        op = ops.get(a.op_docto)
        if op and _estado_op(op.cantidad, op.cant_consumida) == "Completado":
            continue
        maq = maquinas.get(a.maquina_id)
        col = board.setdefault(a.maquina_id, {
            "maquina_nombre": maq.nombre if maq else str(a.maquina_id),
            "ordenes": [],
        })
        col["ordenes"].append({
            "op_docto": a.op_docto,
            "item": op.item if op else None,
            "prioridad": a.prioridad,
            "estado": _estado_op(op.cantidad if op else None, op.cant_consumida if op else None),
        })
    return {"columnas": list(board.values())}


def tool_get_capacidad_semana(
    db: Session,
    semana: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    """Capacidad por máquina para la semana (horas disponibles, asignadas, paradas)."""
    lunes = _parse_dt(semana) or _lunes_de_hoy()
    rows = get_capacidad_semana(db, lunes)
    return {
        "semana_inicio": lunes.isoformat(),
        "maquinas": [r.model_dump() for r in rows],
    }


def tool_get_feasibility(
    db: Session,
    maquina_id: int,
    semana: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    """Órdenes alcanzables vs en riesgo para una máquina en la semana."""
    lunes = _parse_dt(semana) or _lunes_de_hoy()
    return get_feasibility(db, maquina_id, lunes)


def tool_get_gantt_data(
    db: Session,
    desde: Optional[str] = None,
    hasta: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    """Datos del Gantt (tareas + mantenimientos + paradas) en un rango. Por defecto próxima semana."""
    hoy = datetime.utcnow()
    d = _parse_dt(desde) or hoy
    h = _parse_dt(hasta) or (hoy + timedelta(days=7))
    data = get_gantt_data(db, d, h)
    return {
        "desde": d.isoformat(),
        "hasta": h.isoformat(),
        "recursos": [r.model_dump() for r in data.recursos],
        "tareas": [t.model_dump() for t in data.tareas],
    }


def tool_list_paradas_programadas(
    db: Session,
    maquina_id: Optional[int] = None,
    solo_futuras: bool = True,
    **_: Any,
) -> Dict[str, Any]:
    """Paradas programadas (preventivos, limpieza, etc.)."""
    q = db.query(ParadaProgramada)
    if maquina_id:
        q = q.filter(ParadaProgramada.maquina_id == maquina_id)
    if solo_futuras:
        q = q.filter(ParadaProgramada.fin >= datetime.utcnow())
    rows = q.order_by(ParadaProgramada.inicio).all()
    maquinas = {m.Id: m.nombre for m in db.query(Maquina).all()}
    items = [{
        "id": p.id,
        "maquina": maquinas.get(p.maquina_id, str(p.maquina_id)),
        "inicio": p.inicio.isoformat(),
        "fin": p.fin.isoformat(),
        "motivo": p.motivo,
        "tipo": p.tipo,
    } for p in rows]
    return {"total": len(items), "paradas": items}


def tool_get_reporte_produccion(
    db: Session,
    semana: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    """Reporte de producción real (registros agregados por día y máquina) para una semana."""
    lunes = _parse_dt(semana) or _lunes_de_hoy()
    return build_production_report(db, lunes)


# ─────────────────────────────────────────────────────────────
# Tool implementations — analíticas (nuevas, para el skill gerente-procesos)
# ─────────────────────────────────────────────────────────────

def _paradas_horas_en_rango(
    db: Session, maquina_id: Optional[int], desde: datetime, hasta: datetime,
) -> List[Dict[str, Any]]:
    """Devuelve paradas (id, motivo, tipo, horas) que solapan el rango."""
    q = db.query(ParadaProgramada).filter(
        ParadaProgramada.fin > desde,
        ParadaProgramada.inicio < hasta,
    )
    if maquina_id is not None:
        q = q.filter(ParadaProgramada.maquina_id == maquina_id)
    out = []
    for p in q.all():
        ini = max(p.inicio, desde)
        fin = min(p.fin, hasta)
        # solo contar horas hábiles solapadas
        horas = operative_hours_between(ini, fin)
        if horas <= 0:
            continue
        out.append({
            "id": p.id,
            "maquina_id": p.maquina_id,
            "motivo": p.motivo or "(sin motivo)",
            "tipo": p.tipo or "otro",
            "horas": round(horas, 2),
        })
    return out


def tool_get_oee_breakdown(
    db: Session,
    maquina_id: int,
    fecha_inicio: str,
    fecha_fin: str,
    **_: Any,
) -> Dict[str, Any]:
    """
    OEE = D × R × Q por máquina en rango.
    - D = (Tiempo planificado - Paradas planeadas) / Tiempo planificado
    - R = Producción total / (Capacidad_hora × Tiempo operativo)
    - Q = Buenas / (Buenas + Clase B + Desecho)
    Asume: planta Lun-Vie 24h; clase_b y desecho cuentan en 'producidas' pero no en 'buenas'.
    """
    desde = _parse_dt(fecha_inicio)
    hasta = _parse_dt(fecha_fin)
    if not desde or not hasta or hasta <= desde:
        return {"error": "Rango de fechas inválido. Usa ISO 8601 y fecha_fin > fecha_inicio."}

    maq = db.query(Maquina).filter(Maquina.Id == maquina_id).first()
    if not maq:
        return {"error": f"Máquina {maquina_id} no existe."}

    tiempo_planificado = operative_hours_between(desde, hasta)
    if tiempo_planificado <= 0:
        return {
            "error": "El rango no incluye horas hábiles (Lun-Vie). Amplía el rango.",
            "maquina": maq.nombre,
        }

    paradas = _paradas_horas_en_rango(db, maquina_id, desde, hasta)
    horas_paradas = sum(p["horas"] for p in paradas)
    tiempo_operativo = max(tiempo_planificado - horas_paradas, 0.0)

    registros = (
        db.query(RegistroProduccion)
        .filter(
            RegistroProduccion.maquina == maquina_id,
            RegistroProduccion.fecha >= desde,
            RegistroProduccion.fecha < hasta,
        )
        .all()
    )
    buenas = sum(int(r.produccion or 0) for r in registros)
    clase_b = sum(int(r.clase_b or 0) for r in registros)
    desecho = sum(int(r.desecho or 0) for r in registros)
    producidas = buenas + clase_b + desecho

    disponibilidad = _safe_div(tiempo_operativo, tiempo_planificado)
    capacidad_ideal = (maq.capacidad_hora or 0) * tiempo_operativo
    rendimiento = _safe_div(producidas, capacidad_ideal)
    calidad = _safe_div(buenas, producidas)

    if None in (disponibilidad, rendimiento, calidad):
        oee = None
    else:
        oee = disponibilidad * rendimiento * calidad

    notas: List[str] = []
    if not registros:
        notas.append("Sin registros de producción en el rango — Rendimiento y Calidad no se pueden calcular.")
    if maq.capacidad_hora in (None, 0):
        notas.append("La máquina no tiene capacidad_hora configurada — Rendimiento no se puede calcular.")
    if horas_paradas > tiempo_planificado:
        notas.append("Las horas de paradas exceden el tiempo planificado; revisar solapamientos.")

    return {
        "maquina": {"id": maq.Id, "nombre": maq.nombre, "capacidad_hora": maq.capacidad_hora},
        "periodo": {"desde": desde.isoformat(), "hasta": hasta.isoformat()},
        "tiempo_planificado_h": round(tiempo_planificado, 2),
        "tiempo_paradas_h": round(horas_paradas, 2),
        "tiempo_operativo_h": round(tiempo_operativo, 2),
        "unidades_buenas": buenas,
        "unidades_clase_b": clase_b,
        "unidades_desecho": desecho,
        "unidades_producidas": producidas,
        "disponibilidad": round(disponibilidad, 4) if disponibilidad is not None else None,
        "rendimiento": round(rendimiento, 4) if rendimiento is not None else None,
        "calidad": round(calidad, 4) if calidad is not None else None,
        "oee": round(oee, 4) if oee is not None else None,
        "n_registros": len(registros),
        "n_paradas": len(paradas),
        "notas": notas,
    }


def tool_get_paradas_pareto(
    db: Session,
    fecha_inicio: str,
    fecha_fin: str,
    maquina_id: Optional[int] = None,
    top: int = 10,
    **_: Any,
) -> Dict[str, Any]:
    """Pareto de paradas por motivo (horas hábiles consumidas, %, % acumulado)."""
    desde = _parse_dt(fecha_inicio)
    hasta = _parse_dt(fecha_fin)
    if not desde or not hasta or hasta <= desde:
        return {"error": "Rango de fechas inválido."}

    paradas = _paradas_horas_en_rango(db, maquina_id, desde, hasta)
    if not paradas:
        return {
            "rango": {"desde": desde.isoformat(), "hasta": hasta.isoformat()},
            "maquina_id": maquina_id,
            "total_horas": 0,
            "motivos": [],
            "notas": ["Sin paradas registradas en el rango."],
        }

    agrupado: Dict[str, Dict[str, Any]] = {}
    for p in paradas:
        key = p["motivo"]
        slot = agrupado.setdefault(key, {"motivo": key, "horas": 0.0, "n_eventos": 0})
        slot["horas"] += p["horas"]
        slot["n_eventos"] += 1

    total = sum(s["horas"] for s in agrupado.values())
    motivos = sorted(agrupado.values(), key=lambda s: s["horas"], reverse=True)[:top]

    acumulado = 0.0
    for m in motivos:
        m["horas"] = round(m["horas"], 2)
        m["pct"] = round(m["horas"] / total * 100, 2) if total else 0.0
        acumulado += m["pct"]
        m["pct_acumulado"] = round(acumulado, 2)

    return {
        "rango": {"desde": desde.isoformat(), "hasta": hasta.isoformat()},
        "maquina_id": maquina_id,
        "total_horas": round(total, 2),
        "motivos": motivos,
    }


_KPI_SOPORTADOS = {"throughput", "rendimiento", "calidad", "produccion"}
_GRANULARIDAD_SOPORTADA = {"dia", "semana"}


def _periodo_clave(dt: datetime, granularidad: str) -> str:
    if granularidad == "semana":
        lunes = dt.date() - timedelta(days=dt.weekday())
        return lunes.isoformat()
    return dt.date().isoformat()


def _calcular_kpi_punto(
    kpi: str, buenas: int, clase_b: int, desecho: int, capacidad_hora: int, horas_operativas: float,
) -> Optional[float]:
    producidas = buenas + clase_b + desecho
    if kpi == "produccion":
        return float(producidas)
    if kpi == "throughput":
        return _safe_div(producidas, horas_operativas)
    if kpi == "calidad":
        return _safe_div(buenas, producidas)
    if kpi == "rendimiento":
        return _safe_div(producidas, capacidad_hora * horas_operativas) if capacidad_hora else None
    return None


def tool_get_kpi_series(
    db: Session,
    kpi: str,
    granularidad: str,
    fecha_inicio: str,
    fecha_fin: str,
    maquina_id: Optional[int] = None,
    **_: Any,
) -> Dict[str, Any]:
    """
    Serie temporal de un KPI por día o semana. Útil para SPC, tendencias y gráficas.
    KPIs soportados: throughput (u/h), rendimiento (0-1), calidad (0-1), produccion (unidades).
    """
    kpi = (kpi or "").lower().strip()
    granularidad = (granularidad or "dia").lower().strip()
    if kpi not in _KPI_SOPORTADOS:
        return {"error": f"KPI '{kpi}' no soportado. Soportados: {sorted(_KPI_SOPORTADOS)}."}
    if granularidad not in _GRANULARIDAD_SOPORTADA:
        return {"error": f"Granularidad '{granularidad}' no soportada. Soportadas: {sorted(_GRANULARIDAD_SOPORTADA)}."}

    desde = _parse_dt(fecha_inicio)
    hasta = _parse_dt(fecha_fin)
    if not desde or not hasta or hasta <= desde:
        return {"error": "Rango de fechas inválido."}

    q = db.query(RegistroProduccion).filter(
        RegistroProduccion.fecha >= desde, RegistroProduccion.fecha < hasta,
    )
    if maquina_id is not None:
        q = q.filter(RegistroProduccion.maquina == maquina_id)
    registros = q.all()

    maquinas = {m.Id: m for m in db.query(Maquina).all()}

    # Agrupar producción por periodo
    bucket: Dict[str, Dict[str, Any]] = {}
    for r in registros:
        if not r.fecha:
            continue
        key = _periodo_clave(r.fecha, granularidad)
        slot = bucket.setdefault(key, {"periodo": key, "buenas": 0, "clase_b": 0, "desecho": 0, "n": 0, "maquinas": set()})
        slot["buenas"] += int(r.produccion or 0)
        slot["clase_b"] += int(r.clase_b or 0)
        slot["desecho"] += int(r.desecho or 0)
        slot["n"] += 1
        slot["maquinas"].add(r.maquina)

    # Para cada bucket calcular horas operativas hábiles y KPI
    puntos: List[Dict[str, Any]] = []
    for key, slot in sorted(bucket.items()):
        if granularidad == "dia":
            ini = datetime.fromisoformat(key)
            fin = ini + timedelta(days=1)
        else:
            ini = datetime.fromisoformat(key)
            fin = ini + timedelta(days=7)
        ini = max(ini, desde)
        fin = min(fin, hasta)
        horas_periodo = operative_hours_between(ini, fin)

        # Capacidad efectiva: si se filtra una sola máquina, usa su capacidad; si no, suma de capacidades distintas
        if maquina_id is not None:
            cap = maquinas.get(maquina_id).capacidad_hora if maquinas.get(maquina_id) else 0
            horas_op = horas_periodo
        else:
            ids = slot["maquinas"]
            cap = sum((maquinas[i].capacidad_hora or 0) for i in ids if i in maquinas)
            horas_op = horas_periodo  # asume mismo calendario para todas

        valor = _calcular_kpi_punto(
            kpi,
            slot["buenas"], slot["clase_b"], slot["desecho"],
            cap or 0, horas_op or 0,
        )
        puntos.append({
            "periodo": key,
            "valor": round(valor, 4) if valor is not None else None,
            "n_registros": slot["n"],
            "horas_operativas": round(horas_op, 2),
        })

    return {
        "kpi": kpi,
        "granularidad": granularidad,
        "rango": {"desde": desde.isoformat(), "hasta": hasta.isoformat()},
        "maquina_id": maquina_id,
        "n_puntos": len(puntos),
        "puntos": puntos,
    }


def tool_get_descriptiva(
    db: Session,
    kpi: str,
    fecha_inicio: str,
    fecha_fin: str,
    granularidad: str = "dia",
    maquina_id: Optional[int] = None,
    agrupar_por: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    """
    Estadística descriptiva robusta (n, media, mediana, σ, CV, P10, P50, P90, mín, máx)
    de un KPI sobre la serie de puntos producidos por get_kpi_series.
    agrupar_por: 'maquina' opcional (genera un grupo por máquina si maquina_id no se fijó).
    """
    if agrupar_por == "maquina" and maquina_id is None:
        maquinas = db.query(Maquina).all()
        grupos = []
        for m in maquinas:
            serie = tool_get_kpi_series(
                db, kpi=kpi, granularidad=granularidad,
                fecha_inicio=fecha_inicio, fecha_fin=fecha_fin, maquina_id=m.Id,
            )
            if "error" in serie:
                continue
            stats = _descriptiva_de_puntos(serie.get("puntos", []))
            stats["clave"] = m.nombre
            grupos.append(stats)
        return {
            "kpi": kpi,
            "granularidad": granularidad,
            "agrupar_por": "maquina",
            "rango": {"desde": fecha_inicio, "hasta": fecha_fin},
            "grupos": grupos,
        }

    serie = tool_get_kpi_series(
        db, kpi=kpi, granularidad=granularidad,
        fecha_inicio=fecha_inicio, fecha_fin=fecha_fin, maquina_id=maquina_id,
    )
    if "error" in serie:
        return serie
    stats = _descriptiva_de_puntos(serie.get("puntos", []))
    return {
        "kpi": kpi,
        "granularidad": granularidad,
        "rango": {"desde": fecha_inicio, "hasta": fecha_fin},
        "maquina_id": maquina_id,
        **stats,
    }


def _descriptiva_de_puntos(puntos: List[Dict[str, Any]]) -> Dict[str, Any]:
    valores = [p["valor"] for p in puntos if p.get("valor") is not None]
    n = len(valores)
    if n == 0:
        return {"n": 0, "notas": ["Sin puntos con valor para calcular estadística."]}
    media = statistics.fmean(valores)
    mediana = statistics.median(valores)
    desv = statistics.pstdev(valores) if n > 1 else 0.0
    cv = (desv / media) if media else None

    valores_ord = sorted(valores)
    def _pct(p: float) -> float:
        if n == 1:
            return valores_ord[0]
        k = (n - 1) * p
        f = int(k)
        c = min(f + 1, n - 1)
        return valores_ord[f] + (valores_ord[c] - valores_ord[f]) * (k - f)

    return {
        "n": n,
        "media": round(media, 4),
        "mediana": round(mediana, 4),
        "desv_std": round(desv, 4),
        "cv": round(cv, 4) if cv is not None else None,
        "min": round(valores_ord[0], 4),
        "max": round(valores_ord[-1], 4),
        "p10": round(_pct(0.10), 4),
        "p50": round(_pct(0.50), 4),
        "p90": round(_pct(0.90), 4),
    }


# ─────────────────────────────────────────────────────────────
# Registry + dispatch
# ─────────────────────────────────────────────────────────────

TOOLS: Dict[str, Callable[..., Dict[str, Any]]] = {
    "list_ordenes_produccion": tool_list_ordenes_produccion,
    "get_orden_detalle": tool_get_orden_detalle,
    "get_kpis_produccion": tool_get_kpis_produccion,
    "list_maquinas": tool_list_maquinas,
    "get_planning_board": tool_get_planning_board,
    "get_capacidad_semana": tool_get_capacidad_semana,
    "get_feasibility": tool_get_feasibility,
    "get_gantt_data": tool_get_gantt_data,
    "list_paradas_programadas": tool_list_paradas_programadas,
    "get_reporte_produccion": tool_get_reporte_produccion,
    # Analíticas
    "get_oee_breakdown": tool_get_oee_breakdown,
    "get_paradas_pareto": tool_get_paradas_pareto,
    "get_kpi_series": tool_get_kpi_series,
    "get_descriptiva": tool_get_descriptiva,
}


def dispatch_tool(db: Session, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Ejecuta una tool por nombre. Si falla devuelve {error: ...} para que el agente lo maneje."""
    fn = TOOLS.get(name)
    if not fn:
        return {"error": f"Tool '{name}' no existe"}
    try:
        return fn(db=db, **(args or {}))
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}"}


# ─────────────────────────────────────────────────────────────
# Tool declarations (Anthropic schema)
# ─────────────────────────────────────────────────────────────

ANTHROPIC_TOOLS: List[Dict[str, Any]] = [
    {
        "name": "list_ordenes_produccion",
        "description": (
            "Lista órdenes de producción (OPs) con filtros opcionales. "
            "Úsala para preguntas sobre OPs activas, pendientes, completadas, "
            "búsquedas por texto (item, marca, número de OP), o filtros por fecha de entrega "
            "(p.ej. 'qué OPs se entregan el lunes', 'OPs por entregar esta semana', "
            "'pedidos próximos a vencer'). "
            "Puede ordenar por fecha de entrega ascendente con ordenar_por='fecha_entrega'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "estado": {"type": "string", "description": "Filtrar por estado: 'Pendiente', 'En proceso', 'Completado'."},
                "buscar": {"type": "string", "description": "Texto libre para buscar en item/marca/ext o número de OP."},
                "fecha_entrega_desde": {
                    "type": "string",
                    "description": "Fecha mínima en ISO 8601 (ej. '2026-04-27'). Inclusivo.",
                },
                "fecha_entrega_hasta": {
                    "type": "string",
                    "description": "Fecha máxima en ISO 8601. Inclusivo (si solo fecha, cubre hasta 23:59:59).",
                },
                "ordenar_por": {
                    "type": "string",
                    "description": "'fecha_entrega' (ASC, más urgente primero) o vacío.",
                    "enum": ["fecha_entrega"],
                },
                "limit": {"type": "integer", "description": "Máximo de resultados (default 20)."},
            },
        },
    },
    {
        "name": "get_orden_detalle",
        "description": "Detalle completo de una OP por su número (docto), incluyendo máquina asignada y fechas.",
        "input_schema": {
            "type": "object",
            "properties": {"op_docto": {"type": "integer", "description": "Número de la OP."}},
            "required": ["op_docto"],
        },
    },
    {
        "name": "get_kpis_produccion",
        "description": "KPIs globales de producción: totales de OPs por estado y % completado. Para preguntas como '¿cuántas OPs activas?' o '¿cuál es el avance?'.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_maquinas",
        "description": "Lista las máquinas de la planta con capacidad/hora y centro de costos. Úsala para conocer los IDs de máquinas.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_planning_board",
        "description": "Tablero Kanban: asignaciones activas agrupadas por máquina, ordenadas por prioridad.",
        "input_schema": {
            "type": "object",
            "properties": {"maquina_id": {"type": "integer", "description": "Filtrar por ID de máquina."}},
        },
    },
    {
        "name": "get_capacidad_semana",
        "description": "Capacidad por máquina en una semana (horas disponibles, asignadas y por paradas). Sin 'semana' usa la semana actual.",
        "input_schema": {
            "type": "object",
            "properties": {"semana": {"type": "string", "description": "Lunes de la semana en ISO 8601."}},
        },
    },
    {
        "name": "get_feasibility",
        "description": "Analiza si las órdenes asignadas a una máquina caben en la capacidad semanal. Devuelve alcanzables vs en_riesgo.",
        "input_schema": {
            "type": "object",
            "properties": {
                "maquina_id": {"type": "integer", "description": "ID de la máquina."},
                "semana": {"type": "string", "description": "Lunes de la semana en ISO 8601."},
            },
            "required": ["maquina_id"],
        },
    },
    {
        "name": "get_gantt_data",
        "description": "Datos del Gantt (asignaciones + paradas + mantenimientos) en un rango. Por defecto próximos 7 días.",
        "input_schema": {
            "type": "object",
            "properties": {
                "desde": {"type": "string", "description": "Fecha desde (ISO 8601). Default hoy."},
                "hasta": {"type": "string", "description": "Fecha hasta (ISO 8601). Default hoy + 7 días."},
            },
        },
    },
    {
        "name": "list_paradas_programadas",
        "description": "Lista paradas programadas (preventivos, limpieza, etc.). Por defecto solo futuras.",
        "input_schema": {
            "type": "object",
            "properties": {
                "maquina_id": {"type": "integer", "description": "Filtrar por máquina."},
                "solo_futuras": {"type": "boolean", "description": "Si false, incluye pasadas. Default true."},
            },
        },
    },
    {
        "name": "get_reporte_produccion",
        "description": "Reporte de producción real (registros agregados por día y máquina) para una semana.",
        "input_schema": {
            "type": "object",
            "properties": {"semana": {"type": "string", "description": "Lunes de la semana en ISO 8601. Default semana actual."}},
        },
    },
    # ─── Analíticas ────────────────────────────────────────
    {
        "name": "get_oee_breakdown",
        "description": (
            "Calcula OEE (Disponibilidad × Rendimiento × Calidad) para una máquina en un rango. "
            "Devuelve los 3 componentes por separado más tiempos, unidades y notas. "
            "Úsala cuando el usuario pregunte por OEE, disponibilidad, eficiencia, rendimiento o calidad "
            "de una máquina específica en un periodo."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "maquina_id": {"type": "integer", "description": "ID de la máquina."},
                "fecha_inicio": {"type": "string", "description": "Inicio del rango (ISO 8601)."},
                "fecha_fin": {"type": "string", "description": "Fin del rango (ISO 8601, exclusivo)."},
            },
            "required": ["maquina_id", "fecha_inicio", "fecha_fin"],
        },
    },
    {
        "name": "get_paradas_pareto",
        "description": (
            "Pareto de paradas: agrupa por motivo, suma horas hábiles consumidas, calcula % y % acumulado. "
            "Úsala para análisis 80/20 de tiempo perdido por mantenimiento, limpieza, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "fecha_inicio": {"type": "string", "description": "Inicio del rango (ISO 8601)."},
                "fecha_fin": {"type": "string", "description": "Fin del rango (ISO 8601, exclusivo)."},
                "maquina_id": {"type": "integer", "description": "Filtrar por máquina (opcional)."},
                "top": {"type": "integer", "description": "Top N motivos (default 10)."},
            },
            "required": ["fecha_inicio", "fecha_fin"],
        },
    },
    {
        "name": "get_kpi_series",
        "description": (
            "Serie temporal de un KPI (throughput, rendimiento, calidad, produccion) por día o semana. "
            "Útil para detectar tendencias, aplicar reglas Western Electric / SPC, comparar periodos."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "kpi": {"type": "string", "description": "KPI a calcular.", "enum": ["throughput", "rendimiento", "calidad", "produccion"]},
                "granularidad": {"type": "string", "description": "Agregación temporal.", "enum": ["dia", "semana"]},
                "fecha_inicio": {"type": "string", "description": "Inicio del rango (ISO 8601)."},
                "fecha_fin": {"type": "string", "description": "Fin del rango (ISO 8601, exclusivo)."},
                "maquina_id": {"type": "integer", "description": "Filtrar por máquina (opcional)."},
            },
            "required": ["kpi", "granularidad", "fecha_inicio", "fecha_fin"],
        },
    },
    {
        "name": "get_descriptiva",
        "description": (
            "Estadística descriptiva (n, media, mediana, σ, CV, P10/P50/P90, mín, máx) del KPI indicado. "
            "Si agrupar_por='maquina' y no se fija maquina_id, devuelve un grupo por máquina."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "kpi": {"type": "string", "description": "KPI a analizar.", "enum": ["throughput", "rendimiento", "calidad", "produccion"]},
                "granularidad": {"type": "string", "description": "Agregación de la serie base.", "enum": ["dia", "semana"]},
                "fecha_inicio": {"type": "string", "description": "Inicio del rango (ISO 8601)."},
                "fecha_fin": {"type": "string", "description": "Fin del rango (ISO 8601, exclusivo)."},
                "maquina_id": {"type": "integer", "description": "Filtrar por máquina (opcional)."},
                "agrupar_por": {"type": "string", "description": "'maquina' para desagregar por máquina.", "enum": ["maquina"]},
            },
            "required": ["kpi", "fecha_inicio", "fecha_fin"],
        },
    },
]
