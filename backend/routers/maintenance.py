from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, joinedload
from database import get_db
from auth import get_current_user, require_roles
from models.maintenance import (
    SolicitudMantenimiento, EstadoSolicitud, AsuntoMantenimiento,
    MotivoMantenimiento, BitacoraSolicitud, Existencia,
)
from models.production import Maquina
from schemas.maintenance import (
    SolicitudMantenimientoOut, SolicitudMantenimientoCreate,
    SolicitudMantenimientoUpdate, BitacoraOut, BitacoraCreate, ExistenciaOut,
)

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


def _to_out(t: SolicitudMantenimiento, db: Session) -> SolicitudMantenimientoOut:
    maq = db.query(Maquina).filter(Maquina.Id == t.row_maquina).first()
    estado = db.query(EstadoSolicitud).filter(EstadoSolicitud.Id == t.row_estado).first()
    asunto = db.query(AsuntoMantenimiento).filter(AsuntoMantenimiento.Id == t.row_asunto).first()
    motivo = db.query(MotivoMantenimiento).filter(MotivoMantenimiento.Id == t.row_motivo).first()
    return SolicitudMantenimientoOut(
        Id=t.Id,
        fecha=t.fecha,
        ticket=t.ticket,
        row_maquina=t.row_maquina,
        maquina_nombre=maq.nombre if maq else None,
        row_estado=t.row_estado,
        estado_descripcion=estado.estado_descripcion_solicitud if estado else None,
        descripcion_problema=t.descripcion_problema,
        row_motivo=t.row_motivo,
        motivo=motivo.motivo if motivo else None,
        row_asunto=t.row_asunto,
        asunto=asunto.asunto if asunto else None,
        row_mecanico=t.row_mecanico,
        fecha_solucion=t.fecha_solucion,
    )


@router.get("/tickets", response_model=dict)
def list_tickets(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    estado: Optional[int] = Query(default=None, description="1=En proceso, 2=Solucionado, 3=Cancelado"),
    maquina_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(SolicitudMantenimiento)
    if estado is not None:
        q = q.filter(SolicitudMantenimiento.row_estado == estado)
    if maquina_id:
        q = q.filter(SolicitudMantenimiento.row_maquina == maquina_id)

    total = q.count()
    tickets = q.order_by(SolicitudMantenimiento.fecha.desc()).offset((page - 1) * page_size).limit(page_size).all()
    items = [_to_out(t, db) for t in tickets]

    return {"total": total, "page": page, "page_size": page_size, "items": [i.model_dump() for i in items]}


@router.get("/tickets/activos", response_model=List[SolicitudMantenimientoOut])
def tickets_activos(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Tickets abiertos = máquinas paradas ahora mismo."""
    tickets = db.query(SolicitudMantenimiento).filter(
        SolicitudMantenimiento.row_estado == 1
    ).all()
    return [_to_out(t, db) for t in tickets]


@router.get("/tickets/{ticket_id}", response_model=SolicitudMantenimientoOut)
def get_ticket(ticket_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    t = db.query(SolicitudMantenimiento).filter(SolicitudMantenimiento.Id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    return _to_out(t, db)


@router.post("/tickets", response_model=SolicitudMantenimientoOut)
def create_ticket(
    body: SolicitudMantenimientoCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    data = body.model_dump()
    data.pop("ticket", None)
    t = SolicitudMantenimiento(**data, created_at=datetime.now())
    db.add(t)
    db.commit()
    db.refresh(t)
    t.ticket = f"tk{t.Id}"
    db.commit()
    db.refresh(t)
    return _to_out(t, db)


@router.patch("/tickets/{ticket_id}", response_model=SolicitudMantenimientoOut)
def update_ticket(
    ticket_id: int,
    body: SolicitudMantenimientoUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    t = db.query(SolicitudMantenimiento).filter(SolicitudMantenimiento.Id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _to_out(t, db)


@router.get("/tickets/{ticket_id}/bitacora", response_model=List[BitacoraOut])
def get_bitacora(ticket_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    entries = db.query(BitacoraSolicitud).filter(
        BitacoraSolicitud.row_ticket == ticket_id
    ).order_by(BitacoraSolicitud.fecha.asc()).all()
    return entries


@router.post("/tickets/{ticket_id}/bitacora", response_model=BitacoraOut)
def create_bitacora(
    ticket_id: int,
    body: BitacoraCreate,
    db: Session = Depends(get_db),
    _=Depends(require_roles("Administrador", "Supervisor")),
):
    t = db.query(SolicitudMantenimiento).filter(SolicitudMantenimiento.Id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")

    entry = BitacoraSolicitud(
        created_at=datetime.now(),
        fecha=body.fecha,
        row_mecanico=body.row_mecanico,
        bitacora=body.bitacora,
        observaciones=body.observaciones,
        id_repuesto=body.id_repuesto,
        cantidad=body.cantidad,
        Tipo=body.Tipo,
        row_ticket=ticket_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/repuestos", response_model=List[ExistenciaOut])
def search_repuestos(
    q: Optional[str] = Query(default=None, description="Texto a buscar en nombre del ítem"),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Existencia)
    if q:
        query = query.filter(Existencia.item.like(f"%{q}%"))
    return query.order_by(Existencia.Id).limit(limit).all()


@router.get("/catalogos")
def get_catalogos(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Devuelve asuntos, motivos y estados en un solo call para poblar selectores."""
    asuntos = db.query(AsuntoMantenimiento).order_by(AsuntoMantenimiento.Id).all()
    motivos = db.query(MotivoMantenimiento).order_by(MotivoMantenimiento.Id).all()
    estados = db.query(EstadoSolicitud).all()
    return {
        "asuntos": [{"Id": a.Id, "asunto": a.asunto} for a in asuntos],
        "motivos": [{"Id": m.Id, "motivo": m.motivo} for m in motivos],
        "estados": [{"Id": e.Id, "estado": e.estado_descripcion_solicitud} for e in estados],
    }
