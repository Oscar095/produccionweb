"""
Servicio Gantt: proyección de carga por Centro de Trabajo (Ruta SIESA).

Cada fila del Gantt representa una Ruta SIESA. La barra agregada se segmenta en:

  • Atrasado  (rojo)  → unidades de OPs cuya fecha de entrega ya pasó.
  • En riesgo (ámbar) → OPs cuya fecha de entrega es futura, pero cuyo fin
                        proyectado (en cola FIFO por fecha de entrega) cae
                        después de su entrega comprometida.
  • A tiempo  (azul)  → OPs que se cumplen dentro de su fecha de entrega.

La cola FIFO arranca HOY 00:00 (movido al lunes si cae en sáb/dom). Las
horas operativas se acumulan saltando sábado y domingo.
"""
from datetime import datetime
from typing import List, Optional, Dict
from sqlalchemy import cast, String
from sqlalchemy.orm import Session

from models.production import Maquina, OpNumero
from models.planning import RutaSiesa
from schemas.gantt import GanttDataOut, GanttRecurso, GanttTarea, GanttOpDetalle
from services.working_hours import add_operative_hours, _next_business_start


COLOR_ATRASADO = "#EF4444"   # rojo
COLOR_RIESGO   = "#F59E0B"   # ámbar
COLOR_A_TIEMPO = "#3B82F6"   # azul
COLOR_VACIO    = "#9CA3AF"   # gris


def _dedupe_ops_por_docto(rows: List[OpNumero]) -> List[OpNumero]:
    """Una fila por docto: prefiere tipo_inv = '1430K.ex' (producto real)."""
    by_docto: Dict[int, OpNumero] = {}
    for op in rows:
        existing = by_docto.get(op.docto)
        is_real = bool(op.tipo_inv and op.tipo_inv.lower() == "1430k.ex")
        existing_is_real = bool(
            existing and existing.tipo_inv and existing.tipo_inv.lower() == "1430k.ex"
        )
        if existing is None or (is_real and not existing_is_real):
            by_docto[op.docto] = op
    return list(by_docto.values())


def get_gantt_data(
    db: Session,
    desde: datetime,
    hasta: datetime,
    maquina_ids: Optional[List[int]] = None,   # ignorado en este modelo
) -> GanttDataOut:
    rutas = (
        db.query(RutaSiesa)
        .filter(RutaSiesa.activo == True)  # noqa: E712
        .order_by(RutaSiesa.orden.asc(), RutaSiesa.nombre_ruta.asc())
        .all()
    )

    maquinas = (
        db.query(Maquina)
        .filter(Maquina.rutas_siesa_id.isnot(None))
        .all()
    )
    maq_por_ruta: Dict[int, List[Maquina]] = {}
    for m in maquinas:
        maq_por_ruta.setdefault(m.rutas_siesa_id, []).append(m)

    nombres_ruta = [r.nombre_ruta for r in rutas if r.nombre_ruta]
    ops_rows: List[OpNumero] = []
    if nombres_ruta:
        ops_rows = (
            db.query(OpNumero)
            .filter(
                cast(OpNumero.ruta_op, String(200)).in_(nombres_ruta),
                OpNumero.estados == 1,
            )
            .all()
        )

    ops_por_ruta_raw: Dict[str, List[OpNumero]] = {}
    for op in ops_rows:
        key = (op.ruta_op or "").strip()
        if not key:
            continue
        ops_por_ruta_raw.setdefault(key, []).append(op)

    hoy = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    inicio_barra = _next_business_start(hoy)

    recursos: List[GanttRecurso] = []
    tareas: List[GanttTarea] = []

    for r in rutas:
        ms = maq_por_ruta.get(r.id, [])
        cap_hora_total = sum((m.capacidad_hora or 0) for m in ms)
        cap_diaria = cap_hora_total * 24

        ops_dedup = _dedupe_ops_por_docto(ops_por_ruta_raw.get(r.nombre_ruta, []))

        # Filtrar OPs con pendiente real
        ops_pend = [
            op for op in ops_dedup
            if max((op.cantidad or 0) - (op.cant_consumida or 0), 0) > 0
        ]

        # Ordenar por fecha de entrega ASC (las atrasadas y más urgentes primero).
        # Sin fecha → al final.
        ops_pend.sort(key=lambda o: o.f851_fecha_terminacion or datetime.max)

        # Recorrido FIFO: clasificar y proyectar fin de cada OP.
        cursor = inicio_barra
        op_detalles: List[GanttOpDetalle] = []
        unidades_total = 0
        unidades_consumidas = 0
        unidades_pendientes = 0
        unidades_atrasado = 0
        unidades_riesgo = 0
        unidades_a_tiempo = 0
        num_ops_atrasado = 0
        num_ops_riesgo = 0
        num_ops_a_tiempo = 0
        fecha_entrega_min: Optional[datetime] = None

        for op in ops_pend:
            cant = op.cantidad or 0
            cons = op.cant_consumida or 0
            pend = cant - cons
            unidades_total += cant
            unidades_consumidas += cons
            unidades_pendientes += pend

            if cap_hora_total > 0:
                horas_op = pend / cap_hora_total
                fin_op = add_operative_hours(cursor, horas_op)
                dias_op = pend / cap_diaria if cap_diaria else 0.0
            else:
                horas_op = 0.0
                fin_op = cursor
                dias_op = 0.0

            entrega = op.f851_fecha_terminacion
            if entrega and entrega < hoy:
                clase = "atrasada"
                color = COLOR_ATRASADO
                unidades_atrasado += pend
                num_ops_atrasado += 1
            elif entrega and fin_op > entrega:
                clase = "en_riesgo"
                color = COLOR_RIESGO
                unidades_riesgo += pend
                num_ops_riesgo += 1
            else:
                clase = "a_tiempo"
                color = COLOR_A_TIEMPO
                unidades_a_tiempo += pend
                num_ops_a_tiempo += 1

            if entrega and (fecha_entrega_min is None or entrega < fecha_entrega_min):
                fecha_entrega_min = entrega

            op_detalles.append(GanttOpDetalle(
                docto=op.docto,
                item=op.item,
                marca=op.marca,
                cantidad=cant,
                cant_consumida=cons,
                unidades_pendientes=pend,
                fecha_entrega=entrega,
                dias_estimados=round(dias_op, 2),
                fecha_fin_proyectada=fin_op if cap_hora_total > 0 else None,
                clase=clase,
                color=color,
            ))

            cursor = fin_op  # avanza la cola

        # Reordenar el detalle por severidad: atrasadas → riesgo → a tiempo,
        # y dentro de cada grupo por fecha de entrega ASC.
        prio_clase = {"atrasada": 0, "en_riesgo": 1, "a_tiempo": 2}
        op_detalles.sort(key=lambda d: (
            prio_clase.get(d.clase, 99),
            d.fecha_entrega or datetime.max,
        ))

        num_ops = len(op_detalles)
        horas_estimadas = (unidades_pendientes / cap_hora_total) if cap_hora_total else 0.0
        dias_estimados = (unidades_pendientes / cap_diaria) if cap_diaria else 0.0

        dias_atrasado = (unidades_atrasado / cap_diaria) if cap_diaria else 0.0
        dias_riesgo   = (unidades_riesgo   / cap_diaria) if cap_diaria else 0.0
        dias_a_tiempo = (unidades_a_tiempo / cap_diaria) if cap_diaria else 0.0

        fin_barra = (
            add_operative_hours(inicio_barra, horas_estimadas)
            if horas_estimadas > 0
            else inicio_barra
        )

        sobrecargada = num_ops_atrasado > 0 or num_ops_riesgo > 0

        # Estado agregado
        if num_ops == 0 or unidades_pendientes <= 0 or cap_hora_total <= 0:
            estado = "Sin carga"
        elif num_ops_atrasado > 0:
            estado = "Atrasado"
        elif num_ops_riesgo > 0:
            estado = "En riesgo"
        else:
            estado = "A tiempo"

        # Etiqueta de la barra
        if num_ops == 0 or unidades_pendientes <= 0:
            texto = f"{r.nombre_ruta} · sin OPs activas"
        else:
            unidades_fmt = (
                f"{unidades_pendientes/1_000_000:.1f}M"
                if unidades_pendientes >= 1_000_000
                else f"{unidades_pendientes/1_000:.1f}K"
                if unidades_pendientes >= 1_000
                else str(unidades_pendientes)
            )
            texto = f"{num_ops} OPs · {unidades_fmt} u · {dias_estimados:.1f} días"

        recursos.append(GanttRecurso(
            id=r.id,
            nombre=r.nombre_ruta,
            orden=r.orden,
            num_maquinas=len(ms),
            capacidad_hora_total=cap_hora_total,
            capacidad_diaria=cap_diaria,
            num_ops=num_ops,
            unidades_pendientes=unidades_pendientes,
            dias_estimados=round(dias_estimados, 2),
            sobrecargada=sobrecargada,
            ops=op_detalles,
        ))

        tareas.append(GanttTarea(
            id=f"carga-{r.id}",
            texto=texto,
            inicio=inicio_barra,
            fin=fin_barra,
            tipo="carga",
            estado=estado,
            ruta_id=r.id,
            ruta_nombre=r.nombre_ruta,
            num_ops=num_ops,
            unidades_total=unidades_total,
            unidades_pendientes=unidades_pendientes,
            horas_estimadas=round(horas_estimadas, 2),
            dias_estimados=round(dias_estimados, 2),
            capacidad_diaria=cap_diaria,
            dias_atrasado=round(dias_atrasado, 2),
            dias_riesgo=round(dias_riesgo, 2),
            dias_a_tiempo=round(dias_a_tiempo, 2),
            num_ops_atrasado=num_ops_atrasado,
            num_ops_riesgo=num_ops_riesgo,
            num_ops_a_tiempo=num_ops_a_tiempo,
            fecha_entrega_min=fecha_entrega_min,
        ))

    return GanttDataOut(recursos=recursos, tareas=tareas, desde=desde, hasta=hasta)
