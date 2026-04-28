"""
Tools expuestas al agente Koski IA (Gemini function calling).

Cada tool es una función Python que recibe la Session SQLAlchemy actual y
devuelve un dict JSON-serializable. Son read-only: no modifican datos.

FUNCTION_DECLARATIONS se pasa a Gemini para que conozca los tools disponibles.
dispatch_tool() resuelve name -> función y ejecuta.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.production import Maquina, OpNumero, RegistroProduccion
from models.planning import Asignacion, ParadaProgramada, Usuario
from services.gantt_service import get_gantt_data
from services.planning_engine import get_capacidad_semana, get_feasibility
from services.report_service import build_production_report


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


# ─────────────────────────────────────────────────────────────
# Tool implementations
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
        # extender al final del día si vino solo fecha (00:00:00)
        if hasta_dt.hour == 0 and hasta_dt.minute == 0 and hasta_dt.second == 0:
            hasta_dt = hasta_dt + timedelta(hours=23, minutes=59, seconds=59)
        q = q.filter(OpNumero.f851_fecha_terminacion <= hasta_dt)

    if ordenar_por == "fecha_entrega":
        q = q.order_by(OpNumero.f851_fecha_terminacion.asc())
    else:
        q = q.order_by(OpNumero.docto.desc())

    rows = q.limit(limit * 3).all()  # holgura para filtrar por estado en Python

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
    total = len({o.docto for o in ops})  # docto únicos
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
}


def dispatch_tool(name: str, args: Dict[str, Any], db: Session, current_user: Usuario) -> Dict[str, Any]:
    """Ejecuta una tool por nombre. Si falla devuelve {error: ...} para que el agente lo maneje."""
    fn = TOOLS.get(name)
    if not fn:
        return {"error": f"Tool '{name}' no existe"}
    try:
        return fn(db=db, **(args or {}))
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}"}


# ─────────────────────────────────────────────────────────────
# Function declarations (Gemini schema)
# ─────────────────────────────────────────────────────────────

FUNCTION_DECLARATIONS: List[Dict[str, Any]] = [
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
        "parameters": {
            "type": "object",
            "properties": {
                "estado": {"type": "string", "description": "Filtrar por estado: 'Pendiente', 'En proceso', 'Completado'."},
                "buscar": {"type": "string", "description": "Texto libre para buscar en item/marca/ext o número de OP."},
                "fecha_entrega_desde": {
                    "type": "string",
                    "description": "Fecha de entrega mínima en ISO 8601 (ej. '2026-04-27' o '2026-04-27T00:00:00'). El filtro es inclusivo.",
                },
                "fecha_entrega_hasta": {
                    "type": "string",
                    "description": "Fecha de entrega máxima en ISO 8601. Inclusivo (si pasas solo fecha sin hora, se cubre hasta las 23:59:59 de ese día).",
                },
                "ordenar_por": {
                    "type": "string",
                    "description": "Cómo ordenar los resultados: 'fecha_entrega' (ASC, más urgente primero) o vacío para orden por número de OP DESC.",
                    "enum": ["fecha_entrega"],
                },
                "limit": {"type": "integer", "description": "Máximo de resultados (default 20)."},
            },
        },
    },
    {
        "name": "get_orden_detalle",
        "description": "Obtiene el detalle completo de una orden de producción por su número (docto), incluyendo máquina asignada y fechas.",
        "parameters": {
            "type": "object",
            "properties": {"op_docto": {"type": "integer", "description": "Número de la OP."}},
            "required": ["op_docto"],
        },
    },
    {
        "name": "get_kpis_produccion",
        "description": "KPIs globales de producción: totales de OPs por estado y porcentaje completado. Úsala cuando el usuario pregunta cosas como '¿cuántas OPs están activas?' o '¿cuál es el avance?'.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "list_maquinas",
        "description": "Lista las máquinas de la planta con capacidad por hora y centro de costos. Úsala cuando el usuario pregunta qué máquinas hay o necesita el ID de una máquina para otra tool.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_planning_board",
        "description": "Tablero Kanban: asignaciones activas agrupadas por máquina, ordenadas por prioridad. Filtrable por máquina.",
        "parameters": {
            "type": "object",
            "properties": {"maquina_id": {"type": "integer", "description": "Filtrar por ID de máquina."}},
        },
    },
    {
        "name": "get_capacidad_semana",
        "description": "Capacidad por máquina en una semana: horas disponibles, asignadas y por paradas. Si no se pasa 'semana', usa la semana actual.",
        "parameters": {
            "type": "object",
            "properties": {"semana": {"type": "string", "description": "Lunes de la semana en ISO 8601 (ej. '2026-04-20T00:00:00'). Opcional."}},
        },
    },
    {
        "name": "get_feasibility",
        "description": "Analiza si las órdenes asignadas a una máquina caben en la capacidad de la semana. Devuelve 'alcanzables' y 'en_riesgo'.",
        "parameters": {
            "type": "object",
            "properties": {
                "maquina_id": {"type": "integer", "description": "ID de la máquina."},
                "semana": {"type": "string", "description": "Lunes de la semana en ISO 8601. Opcional."},
            },
            "required": ["maquina_id"],
        },
    },
    {
        "name": "get_gantt_data",
        "description": "Datos del diagrama Gantt: asignaciones + paradas + mantenimientos en un rango de fechas. Por defecto próximos 7 días.",
        "parameters": {
            "type": "object",
            "properties": {
                "desde": {"type": "string", "description": "Fecha desde (ISO 8601). Default hoy."},
                "hasta": {"type": "string", "description": "Fecha hasta (ISO 8601). Default hoy + 7 días."},
            },
        },
    },
    {
        "name": "list_paradas_programadas",
        "description": "Lista paradas programadas (preventivos, limpieza, etc.). Por defecto solo paradas futuras.",
        "parameters": {
            "type": "object",
            "properties": {
                "maquina_id": {"type": "integer", "description": "Filtrar por máquina."},
                "solo_futuras": {"type": "boolean", "description": "Si es false, incluye paradas pasadas también. Default true."},
            },
        },
    },
    {
        "name": "get_reporte_produccion",
        "description": "Reporte de producción real (registros agregados por día y máquina) para una semana. Útil para preguntas sobre producción pasada.",
        "parameters": {
            "type": "object",
            "properties": {"semana": {"type": "string", "description": "Lunes de la semana en ISO 8601. Default semana actual."}},
        },
    },
]
