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
    compute_tasa_servicio, compute_disponibilidad,
    compute_eficiencia, compute_calidad, iter_semanas_mes,
)

router = APIRouter(prefix="/api/indicadores", tags=["indicadores"])


_KPI_TO_META = {
    "tasa_servicio": "tasa_servicio",
    "disponibilidad": "disponibilidad",
    "eficiencia": "eficiencia",
    "calidad": None,  # Calidad no tiene meta sembrada por defecto
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


def _bounds_mes(year: int, month: int) -> tuple[datetime, datetime]:
    """Inicio del mes (00:00:00) y fin acotado a hoy si el mes es el actual."""
    inicio = datetime(year, month, 1, 0, 0, 0)
    ultimo = monthrange(year, month)[1]
    fin_mes = datetime(year, month, ultimo, 23, 59, 59)
    hoy = datetime.now()
    fin = min(fin_mes, hoy)
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
    Para un período dado, calcula el KPI por cada máquina y lo devuelve como
    MaquinaValorOut (campos uniformes). Para tasa_servicio iteramos máquinas
    porque la función agregada no produce desglose por máquina nativamente.
    """
    if kpi_internal == "disponibilidad":
        _, lista, _, _ = compute_disponibilidad(db, inicio, fin, None)
        return [
            MaquinaValorOut(maquina_id=m.maquina_id, maquina_nombre=m.maquina_nombre, valor=m.disponibilidad_pct)
            for m in lista
        ]
    if kpi_internal == "eficiencia":
        _, lista, _, _ = compute_eficiencia(db, inicio, fin, None)
        return [
            MaquinaValorOut(maquina_id=m.maquina_id, maquina_nombre=m.maquina_nombre, valor=m.eficiencia_pct)
            for m in lista
        ]
    if kpi_internal == "calidad":
        _, lista, _, _ = compute_calidad(db, inicio, fin, None)
        return [
            MaquinaValorOut(maquina_id=m.maquina_id, maquina_nombre=m.maquina_nombre, valor=m.calidad_pct)
            for m in lista
        ]
    if kpi_internal == "tasa_servicio":
        # Iterar máquinas con asignaciones en el período
        from models.production import Maquina
        from models.planning import Asignacion
        ids = {
            mid for (mid,) in db.query(Asignacion.maquina_id)
            .filter(Asignacion.suspendida == False)
            .distinct().all()
            if mid is not None
        }
        if not ids:
            return []
        maquinas = db.query(Maquina).filter(Maquina.Id.in_(ids)).all()
        out: list[MaquinaValorOut] = []
        for m in maquinas:
            valor, total, _ = compute_tasa_servicio(db, inicio, fin, m.Id)
            if total == 0:
                continue
            out.append(MaquinaValorOut(maquina_id=m.Id, maquina_nombre=m.nombre, valor=valor))
        out.sort(key=lambda x: x.valor)
        return out
    return []


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
        inicio, fin = _bounds_mes(year, month)
        mes_label = f"{_MESES_LARGO[month]} {year}"
        for sem_ini, sem_fin, label in iter_semanas_mes(year, month):
            sem_fin_efectivo = min(sem_fin, hoy)
            if sem_fin_efectivo < sem_ini:
                continue
            por_semana.append(SemanaValorOut(
                semana_label=label,
                inicio=sem_ini.date(),
                fin=sem_fin.date(),
                valor=_compute_one(kpi_norm, db, sem_ini, sem_fin_efectivo, maquina_id),
            ))

    valor_periodo = _compute_one(kpi_norm, db, inicio, fin, maquina_id)
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
