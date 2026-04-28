"""
Cálculo de horas operativas: la planta opera 24 h/día de Lunes a Viernes.
Sábado (weekday=5) y Domingo (weekday=6) se excluyen.
"""
from datetime import datetime, timedelta


def _is_weekend(dt: datetime) -> bool:
    return dt.weekday() >= 5


def _next_business_start(dt: datetime) -> datetime:
    """Si dt cae en sábado/domingo, lo mueve al lunes siguiente a las 00:00."""
    while _is_weekend(dt):
        dt = (dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return dt


def add_operative_hours(start: datetime, hours: float) -> datetime:
    """
    Suma `hours` (decimal) a `start` consumiendo solo horas en Lun-Vie.
    Si `start` cae en fin de semana, arranca en el lunes 00:00 siguiente.
    """
    if hours <= 0:
        return _next_business_start(start)

    cursor = _next_business_start(start)
    remaining = timedelta(hours=hours)

    while remaining > timedelta(0):
        end_of_day = (cursor + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        chunk = end_of_day - cursor
        if remaining <= chunk:
            return cursor + remaining
        cursor = end_of_day
        remaining -= chunk
        cursor = _next_business_start(cursor)

    return cursor


def operative_hours_between(start: datetime, end: datetime) -> float:
    """
    Cuenta horas Lun-Vie entre `start` y `end`. Útil para reportes y validaciones.
    """
    if end <= start:
        return 0.0

    total = timedelta(0)
    cursor = start
    while cursor < end:
        if not _is_weekend(cursor):
            end_of_day = (cursor + timedelta(days=1)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            chunk_end = min(end, end_of_day)
            total += chunk_end - cursor
            cursor = chunk_end
        else:
            cursor = (cursor + timedelta(days=1)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )

    return total.total_seconds() / 3600.0
