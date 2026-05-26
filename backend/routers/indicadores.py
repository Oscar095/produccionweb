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
)
from services.indicadores_service import (
    compute_tasa_servicio, compute_tasa_servicio_por_maquina,
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
        from models.production import Maquina, OpNumero
        from models.planning import Asignacion
        from sqlalchemy import func

        rows = compute_tasa_servicio_por_maquina(db, inicio, fin)
        nombres = {
            m.Id: m.nombre
            for m in db.query(Maquina).filter(Maquina.Id.in_([r["maquina_id"] for r in rows])).all()
        } if rows else {}

        out: list[MaquinaValorOut] = []
        for r in rows:
            total = r["total"]
            atrasadas = r["atrasadas"]
            tasa = round((1 - atrasadas / total) * 100, 1) if total > 0 else 100.0
            out.append(MaquinaValorOut(
                maquina_id=r["maquina_id"],
                maquina_nombre=nombres.get(r["maquina_id"]),
                valor=tasa,
                total_ops=total,
                ops_atrasadas=atrasadas,
            ))

        # Pseudo-máquina "Sin asignar": OPs no asignadas a ninguna máquina vigente
        inicio_d = inicio.date() if isinstance(inicio, datetime) else inicio
        fin_d = fin.date() if isinstance(fin, datetime) else fin
        hoy_d = datetime.now().date()

        subq_asignadas = db.query(Asignacion.op_docto).filter(Asignacion.suspendida == False).subquery()

        sin_total = db.query(func.count(OpNumero.Id)).filter(
            OpNumero.f851_fecha_terminacion >= inicio_d,
            OpNumero.f851_fecha_terminacion <= fin_d,
            ~OpNumero.docto.in_(subq_asignadas),
        ).scalar() or 0

        sin_atrasadas = db.query(func.count(OpNumero.Id)).filter(
            OpNumero.f851_fecha_terminacion >= inicio_d,
            OpNumero.f851_fecha_terminacion <= fin_d,
            OpNumero.f851_fecha_terminacion < hoy_d,
            OpNumero.cant_consumida < OpNumero.cantidad,
            ~OpNumero.docto.in_(subq_asignadas),
        ).scalar() or 0

        if sin_total > 0:
            tasa_sin = round((1 - sin_atrasadas / sin_total) * 100, 1)
            out.append(MaquinaValorOut(
                maquina_id=0,
                maquina_nombre="Sin asignar",
                valor=tasa_sin,
                total_ops=sin_total,
                ops_atrasadas=sin_atrasadas,
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


@router.get("/{kpi}", response_model=IndicadorOut)
def get_indicador(
    kpi: str,
    mes: Optional[str] = Query(default=None, description="Mes en formato YYYY-MM. Default: mes actual."),
    maquina_id: Optional[int] = Query(default=None, description="Filtrar valor_periodo y por_semana por una máquina."),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    # Aceptar guion o guión bajo
    kpi_norm = kpi.replace("-", "_").lower()
    if kpi_norm not in {"tasa_servicio", "disponibilidad", "eficiencia", "calidad"}:
        raise HTTPException(status_code=404, detail=f"KPI '{kpi}' no encontrado")

    year, month = _parse_mes(mes)

    # tasa_servicio usa el mes completo (OPs futuras siguen siendo compromiso)
    # los demás KPIs acotan a hoy para no extrapolar horas operativas futuras
    if kpi_norm == "tasa_servicio":
        inicio, fin = _bounds_mes(year, month, acotar_a_hoy=False)
    else:
        inicio, fin = _bounds_mes(year, month, acotar_a_hoy=True)

    valor_periodo = _compute_one(kpi_norm, db, inicio, fin, maquina_id)

    # Por semana del mes
    semanas = iter_semanas_mes(year, month)
    hoy = datetime.now()
    por_semana: list[SemanaValorOut] = []
    for sem_ini, sem_fin, label in semanas:
        estado = _sem_estado(sem_ini, sem_fin)

        if kpi_norm == "tasa_servicio":
            # Usar la semana completa para tasa (cuenta OPs por fecha, no horas)
            valor = _compute_one(kpi_norm, db, sem_ini, sem_fin, maquina_id)
        else:
            # Recortar semanas futuras para KPIs basados en horas
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

    # Por máquina (global del mes, sin filtrar por maquina_id para comparar todas)
    por_maquina = _compute_por_maquina(kpi_norm, db, inicio, fin)

    return IndicadorOut(
        kpi=kpi_norm,
        periodo=PeriodoIndicadorOut(
            inicio=inicio.date(),
            fin=fin.date(),
            mes_label=f"{_MESES_LARGO[month]} {year}",
        ),
        meta=_meta_para(db, kpi_norm),
        valor_periodo=valor_periodo,
        por_semana=por_semana,
        por_maquina=por_maquina,
    )
