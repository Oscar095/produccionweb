from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user
from services.gantt_service import get_gantt_data
from schemas.gantt import GanttDataOut

router = APIRouter(prefix="/api/gantt", tags=["gantt"])


@router.get("", response_model=GanttDataOut)
def gantt(
    desde: datetime = Query(default=None, description="Fecha inicio (ISO). Default: lunes de la semana actual"),
    hasta: datetime = Query(default=None, description="Fecha fin (ISO). Default: domingo de la semana actual"),
    centros: Optional[str] = Query(default=None, description="IDs de máquinas separados por coma"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if desde is None:
        hoy = datetime.utcnow().date()
        lunes = hoy - timedelta(days=hoy.weekday())
        desde = datetime.combine(lunes, datetime.min.time())
    if hasta is None:
        hasta = desde + timedelta(days=6, hours=23, minutes=59)

    maquina_ids = None
    if centros:
        try:
            maquina_ids = [int(x.strip()) for x in centros.split(",") if x.strip()]
        except ValueError:
            maquina_ids = None

    return get_gantt_data(db, desde, hasta, maquina_ids)
