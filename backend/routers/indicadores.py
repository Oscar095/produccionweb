"""
Router unificado para los 4 indicadores de planta:
GET /api/indicadores/{kpi}?mes=YYYY-MM&maquina_id=<int|opcional>

kpi ∈ tasa-servicio | disponibilidad | eficiencia | calidad

Devuelve para el mes solicitado:
  - valor_periodo: KPI agregado del mes (filtrado por máquina si se indica)
  - por_semana: lista de semanas L-V del mes con el valor del KPI cada una
  - por_maquina: lista de máquinas con el valor del KPI del mes
  - meta: meta vigente desde planeacion.metas_kpi (si existe)
"""
from __future__ import annotations

from calendar import monthrange
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user
from models.planning import MetaKPI
from schemas.indicadores import (
    IndicadorOut, PeriodoIndicadorOut, SemanaValorOut, MaquinaValorOut,
    OpTasaServicioOut,
)
from services.indicadores_service import (
    compute_tasa_servicio, compute_tasa_servicio_por_maquina,
    resolver_maquina_por_op,
    sync_completaciones,
    compute_disponibilidad, compute_eficiencia, compute_calidad,
    iter_semanas_mes,
)

router = APIRouter(prefix="/api/indicadores", tags=["indicadores"])


_KPI_TO_META = {
    "tasa_servicio": "tasa_servicio",
    "disponibilidad": "disponibilidad",
    "eficiencia": "eficiencia",
    "calidad": "calidad",
}

_MESES_LARGO = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

_MESES_CORTO = [
    "", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]


def _parse_mes(mes: Optional[str]) -> tuple[int, int]:
    """Parse 'YYYY-MM' or return current year/month."""
    if not mes:
        hoy = datetime.now()
        return hoy.year, hoy.month
    try:
        year_str, month_str = mes.split("-")
        year, month = int(year_str), int(month_str)
        if not (1 <= month <= 12):
            raise ValueError
        return year, month
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Parámetro 'mes' debe tener formato YYYY-MM")


def _meta_para(db: Session, kpi: str) -> Optional[float]:
    meta_key = _KPI_TO_META.get(kpi)
    if not meta_key:
        return None
    row = db.query(MetaKPI).filter(MetaKPI.kpi == meta_key).first()
    return float(row.valor) if row else None


def _bounds_mes(year: int, month: int, acotar_a_hoy: bool = True) -> tuple[datetime, datetime]:
    """
    Inicio del mes (00:00:00) y fin del mes.
    Con acotar_a_hoy=True (default): fin = min(último día, ahora) — para KPIs
    basados en horas operativas (disponibilidad, eficiencia, calidad).
    Con acotar_a_hoy=False: fin = último día 23:59:59 del mes completo — para
    tasa_servicio que cuenta OPs por fecha de entrega comprometida.
    """
    inicio = datetime(year, month, 1, 0, 0, 0)
    ultimo = monthrange(year, month)[1]
    fin_mes = datetime(year, month, ultimo, 23, 59, 59)
    if not acotar_a_hoy:
        return inicio, fin_mes
    fin = min(fin_mes, datetime.now())
    if fin < inicio:
        fin = inicio
    return inicio, fin


def _compute_one(
    kpi_internal: str,
    db: Session,
    inicio: datetime,
    fin: datetime,
    maquina_id: Optional[int],
) -> float:
    """Devuelve sólo el valor global del KPI en el período."""
    if kpi_internal == "tasa_servicio":
        valor, _, _ = compute_tasa_servicio(db, inicio, fin, maquina_id)
        return valor
    if kpi_internal == "disponibilidad":
        valor, _, _, _ = compute_disponibilidad(db, inicio, fin, maquina_id)
        return valor
    if kpi_internal == "eficiencia":
        valor, _, _, _ = compute_eficiencia(db, inicio, fin, maquina_id)
        return valor
    if kpi_internal == "calidad":
        valor, _, _, _ = compute_calidad(db, inicio, fin, maquina_id)
        return valor
    raise HTTPException(status_code=400, detail=f"KPI no soportado: {kpi_internal}")


def _compute_por_maquina(
    kpi_internal: str,
    db: Session,
    inicio: datetime,
    fin: datetime,
) -> list[MaquinaValorOut]:
    """
    Calcula el KPI por cada máquina y devuelve MaquinaValorOut con campos
    detallados según el KPI. Para tasa_servicio usa una query agrupada (sin N+1)
    e incluye pseudo-máquina 'Sin asignar' si hay OPs no asignadas.
    """
    if kpi_internal == "disponibilidad":
        _, lista, _, _ = compute_disponibilidad(db, inicio, fin, None)
        return [
            MaquinaValorOut(
                maquina_id=m.maquina_id,
                maquina_nombre=m.maquina_nombre,
                valor=m.disponibilidad_pct,
                dias_trabajados=m.dias_trabajados,
                horas_disponibles=m.horas_disponibles,
                horas_parada=m.horas_parada,
            )
            for m in lista
        ]

    if kpi_internal == "eficiencia":
        _, lista, _, _ = compute_eficiencia(db, inicio, fin, None)
        return [
            MaquinaValorOut(
                maquina_id=m.maquina_id,
                maquina_nombre=m.maquina_nombre,
                valor=m.eficiencia_pct,
                dias_trabajados=m.dias_trabajados,
                horas_operativas=m.horas_operativas,
                capacidad_hora=m.capacidad_hora,
                produccion_real=m.produccion_real,
                produccion_teorica=m.produccion_teorica,
            )
            for m in lista
        ]

    if kpi_internal == "calidad":
        _, lista, _, _ = compute_calidad(db, inicio, fin, None)
        return [
            MaquinaValorOut(
                maquina_id=m.maquina_id,
                maquina_nombre=m.maquina_nombre,
                valor=m.calidad_pct,
                produccion_buena=m.produccion_buena,
                clase_b=m.clase_b,
                desecho=m.desecho,
                produccion_total=m.produccion_total,
            )
            for m in lista
        ]

    if kpi_internal == "tasa_servicio":
        from models.production import Maquina

        # La máquina de cada OP se resuelve por ruta (la fila maquina_id=0 ya
        # viene incluida como "Sin asignar" desde el service).
        rows = compute_tasa_servicio_por_maquina(db, inicio, fin)
        real_ids = [r["maquina_id"] for r in rows if r["maquina_id"] != 0]
        nombres = {
            m.Id: m.nombre
            for m in db.query(Maquina).filter(Maquina.Id.in_(real_ids)).all()
        } if real_ids else {}

        out: list[MaquinaValorOut] = []
        for r in rows:
            total = r["total"]
            atrasadas = r["atrasadas"]
            tasa = round((1 - atrasadas / total) * 100, 1) if total > 0 else 100.0
            mid = r["maquina_id"]
            out.append(MaquinaValorOut(
                maquina_id=mid,
                maquina_nombre="Sin asignar" if mid == 0 else nombres.get(mid),
                valor=tasa,
                total_ops=total,
                ops_atrasadas=atrasadas,
            ))

        out.sort(key=lambda x: x.valor)
        return out

    return []


def _sem_estado(sem_ini: datetime, sem_fin: datetime) -> str:
    hoy = datetime.now()
    if sem_ini > hoy:
        return "futura"
    if sem_fin < hoy:
        return "pasada"
    return "en_curso"


@router.get("/tasa_servicio/ops", response_model=list[OpTasaServicioOut])
def get_ops_tasa_servicio(
    mes: Optional[str] = Query(default=None, description="Mes YYYY-MM. Default: mes actual."),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Lista todas las OPs del mes con su estado de cumplimiento.
    Primero sincroniza completaciones recientes en planeacion.op_cierre.
    """
    from models.production import OpNumero, Maquina, RegistroProduccion
    from models.planning import OpCierre
    from sqlalchemy import func

    sync_completaciones(db)

    year, month = _parse_mes(mes)
    inicio, fin = _bounds_mes(year, month, acotar_a_hoy=False)
    inicio_d = inicio.date()
    fin_d = fin.date()
    hoy_d = date.today()

    ops = (
        db.query(OpNumero)
        .filter(
            OpNumero.tipo_inv.like('%1430K.ex%'),
            OpNumero.f851_fecha_terminacion >= inicio_d,
            OpNumero.f851_fecha_terminacion <= fin_d,
        )
        .order_by(OpNumero.f851_fecha_terminacion)
        .all()
    )
    if not ops:
        return []

    doctos = [op.docto for op in ops]

    # Cierres registrados (para estado histórico de completadas)
    cierres = {
        c.op_docto: c
        for c in db.query(OpCierre).filter(OpCierre.op_docto.in_(doctos)).all()
    }

    # ── Última fecha de registro de producción por OP (para fecha_completada) ──
    prod_rows = (
        db.query(
            RegistroProduccion.numero_op,
            func.max(RegistroProduccion.fecha).label("ultima_fecha"),
        )
        .filter(RegistroProduccion.numero_op.in_(doctos))
        .group_by(RegistroProduccion.numero_op)
        .all()
    )
    op_ultima_fecha: dict[int, date] = {}          # op_docto -> última fecha registro
    for num_op, ultima_f in prod_rows:
        if ultima_f is not None:
            op_ultima_fecha[num_op] = ultima_f.date() if hasattr(ultima_f, 'date') else ultima_f

    # ── Máquina por OP: ruta como base, la producción real prevalece ──
    maq_por_op = resolver_maquina_por_op(db, ops)
    all_maq_ids = set(maq_por_op.values())
    maquinas: dict[int, Maquina] = (
        {m.Id: m for m in db.query(Maquina).filter(Maquina.Id.in_(all_maq_ids)).all()}
        if all_maq_ids else {}
    )

    result: list[OpTasaServicioOut] = []
    for op in ops:
        fp = op.f851_fecha_terminacion
        fecha_prom: date = fp.date() if hasattr(fp, 'date') else fp
        cant = op.cantidad or 0
        consumida = op.cant_consumida or 0
        pct = round(min(consumida / cant * 100, 100), 1) if cant else 0.0

        # Máquina: ruta (base) con prevalencia de producción real
        maq_id = maq_por_op.get(op.docto)
        maq = maquinas.get(maq_id) if maq_id else None

        # Estado y fecha de completación
        cierre = cierres.get(op.docto)
        ultima_f_prod = op_ultima_fecha.get(op.docto)

        if cierre:
            estado: str = "Completada tarde" if cierre.fue_tarde else "A tiempo"
            dias_atraso = (cierre.fecha_completada - fecha_prom).days if cierre.fue_tarde else None
            fecha_completada = cierre.fecha_completada
        elif consumida >= cant and cant > 0:
            estado = "Completada"
            dias_atraso = None
            fecha_completada = ultima_f_prod
        elif fecha_prom < hoy_d:
            estado = "Atrasada"
            dias_atraso = (hoy_d - fecha_prom).days
            fecha_completada = None
        else:
            estado = "En plazo"
            dias_atraso = None
            fecha_completada = None

        result.append(OpTasaServicioOut(
            op_docto=op.docto,
            item=op.item,
            referencia=op.ext1,
            marca=op.marca,
            maquina_id=maq_id,
            maquina_nombre=maq.nombre if maq else None,
            fecha_prometida=fecha_prom,
            fecha_completada=fecha_completada,
            cantidad=cant,
            cant_consumida=consumida,
            pct_completado=pct,
            estado=estado,
            dias_atraso=dias_atraso,
        ))

    return result


@router.get("/{kpi}", response_model=IndicadorOut)
def get_indicador(
    kpi: str,
    mes: Optional[str] = Query(default=None, description="Mes en formato YYYY-MM. Default: mes actual."),
    maquina_id: Optional[int] = Query(default=None, description="Filtrar valor_periodo y por_semana por una máquina."),
    ytd: bool = Query(default=False, description="Si True, calcula desde el 1 de enero del año hasta hoy con desglose mensual."),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    # Aceptar guion o guión bajo
    kpi_norm = kpi.replace("-", "_").lower()
    if kpi_norm not in {"tasa_servicio", "disponibilidad", "eficiencia", "calidad"}:
        raise HTTPException(status_code=404, detail=f"KPI '{kpi}' no encontrado")

    year, month = _parse_mes(mes)

    hoy = datetime.now()
    por_semana: list[SemanaValorOut] = []

    if ytd:
        inicio = datetime(year, 1, 1, 0, 0, 0)
        fin = min(datetime(year, 12, 31, 23, 59, 59), hoy)
        mes_label = f"Acumulado {year}"
        for m in range(1, 13):
            m_ini = datetime(year, m, 1, 0, 0, 0)
            if m_ini > hoy:
                break
            m_fin = min(datetime(year, m, monthrange(year, m)[1], 23, 59, 59), hoy)
            por_semana.append(SemanaValorOut(
                semana_label=_MESES_CORTO[m],
                inicio=m_ini.date(),
                fin=m_fin.date(),
                valor=_compute_one(kpi_norm, db, m_ini, m_fin, maquina_id),
            ))
    else:
        # tasa_servicio usa el mes completo; los demás acotan a hoy
        if kpi_norm == "tasa_servicio":
            inicio, fin = _bounds_mes(year, month, acotar_a_hoy=False)
        else:
            inicio, fin = _bounds_mes(year, month, acotar_a_hoy=True)
        mes_label = f"{_MESES_LARGO[month]} {year}"
        for sem_ini, sem_fin, label in iter_semanas_mes(year, month):
            estado = _sem_estado(sem_ini, sem_fin)
            if kpi_norm == "tasa_servicio":
                valor = _compute_one(kpi_norm, db, sem_ini, sem_fin, maquina_id)
            else:
                sem_fin_efectivo = min(sem_fin, hoy)
                if sem_fin_efectivo < sem_ini:
                    continue
                valor = _compute_one(kpi_norm, db, sem_ini, sem_fin_efectivo, maquina_id)
            por_semana.append(SemanaValorOut(
                semana_label=label,
                inicio=sem_ini.date(),
                fin=sem_fin.date(),
                valor=valor,
                estado=estado,
            ))

    valor_periodo = _compute_one(kpi_norm, db, inicio, fin, maquina_id)

    # Por máquina (global del mes, sin filtrar por maquina_id para comparar todas)
    por_maquina = _compute_por_maquina(kpi_norm, db, inicio, fin)

    return IndicadorOut(
        kpi=kpi_norm,
        periodo=PeriodoIndicadorOut(
            inicio=inicio.date(),
            fin=fin.date(),
            mes_label=mes_label,
        ),
        meta=_meta_para(db, kpi_norm),
        valor_periodo=valor_periodo,
        por_semana=por_semana,
        por_maquina=por_maquina,
    )
