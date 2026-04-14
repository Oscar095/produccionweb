from datetime import datetime, date
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import or_, func, cast, Date
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_roles
from models.production import OpNumero, RegistroProduccion, Maquina, CentroCostos, PersonalPlanta
from models.planning import Asignacion
from schemas.production import (
    OpNumeroOut, KPIProduccionOut, MaquinaOut, CentroCostosOut,
    RegistroProduccionCreate, RegistroProduccionOut, PersonalPlantaOut,
)

router = APIRouter(prefix="/api/production", tags=["production"])


# ── helpers ─────────────────────────────────────────────────

def _registro_to_out(r: RegistroProduccion, db: Session) -> RegistroProduccionOut:
    maq = db.query(Maquina).filter(Maquina.Id == r.maquina).first()
    op  = db.query(OpNumero).filter(OpNumero.docto == r.numero_op).first()
    oper = db.query(PersonalPlanta).filter(PersonalPlanta.Id == r.operario).first()
    lider = db.query(PersonalPlanta).filter(PersonalPlanta.Id == r.lider_turno).first()
    return RegistroProduccionOut(
        Id=r.Id,
        fecha=r.fecha,
        maquina=r.maquina,
        maquina_nombre=maq.nombre if maq else None,
        numero_op=r.numero_op,
        item=op.item if op else None,
        operario=r.operario,
        operario_nombre=oper.nombre_operario if oper else None,
        produccion=r.produccion,
        clase_b=r.clase_b,
        desecho=r.desecho,
        lider_turno=r.lider_turno,
        lider_nombre=lider.nombre_operario if lider else None,
        lote=r.lote,
        kg_lote=r.kg_lote,
        created_at=r.created_at,
    )


# ── órdenes ─────────────────────────────────────────────────

@router.get("/orders", response_model=dict)
def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    estado: Optional[str] = Query(default=None),
    buscar: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(OpNumero)
    if buscar:
        q = q.filter(
            or_(
                OpNumero.item.ilike(f"%{buscar}%"),
                OpNumero.marca.ilike(f"%{buscar}%"),
                OpNumero.docto == (int(buscar) if buscar.isdigit() else -1),
            )
        )
    total = q.count()
    ops = q.order_by(OpNumero.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    items = []
    for op in ops:
        out = OpNumeroOut.model_validate(op)
        if estado and out.estado != estado:
            continue
        items.append(out)
    return {"total": total, "page": page, "page_size": page_size, "items": [i.model_dump() for i in items]}


@router.get("/orders/{docto}", response_model=OpNumeroOut)
def get_order(docto: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    op = db.query(OpNumero).filter(OpNumero.docto == docto).first()
    if not op:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return op


# ── KPIs ────────────────────────────────────────────────────

@router.get("/kpis", response_model=KPIProduccionOut)
def get_kpis(db: Session = Depends(get_db), _=Depends(get_current_user)):
    ops = db.query(OpNumero).all()
    total = len(ops)
    completadas = sum(1 for o in ops if (o.cant_consumida or 0) >= (o.cantidad or 1))
    en_proceso  = sum(1 for o in ops if 0 < (o.cant_consumida or 0) < (o.cantidad or 1))
    pendientes  = sum(1 for o in ops if (o.cant_consumida or 0) <= 0)
    asignadas_doctos = {a.op_docto for a in db.query(Asignacion.op_docto).filter(Asignacion.suspendida == False).all()}
    sin_asignar = sum(1 for o in ops if o.docto not in asignadas_doctos and (o.cant_consumida or 0) < (o.cantidad or 1))
    pct = round(completadas / total * 100, 1) if total else 0.0
    return KPIProduccionOut(
        total_ordenes=total, completadas=completadas, en_proceso=en_proceso,
        pendientes=pendientes, sin_asignar=sin_asignar, pct_completado=pct,
    )


# ── centros de trabajo ───────────────────────────────────────

@router.get("/centers", response_model=List[MaquinaOut])
def list_centers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from models.maintenance import EstadoMaquina
    maquinas = db.query(Maquina).order_by(Maquina.Id).all()
    resultado = []
    for m in maquinas:
        estado_obj = db.query(EstadoMaquina).filter(EstadoMaquina.Id == m.estado).first()
        resultado.append(MaquinaOut(
            Id=m.Id, nombre=m.nombre, capacidad_hora=m.capacidad_hora,
            centro_costos_id=m.centro_costos_id, estado=m.estado,
            estado_descripcion=estado_obj.estado_descripcion if estado_obj else None,
        ))
    return resultado


# ── operarios ────────────────────────────────────────────────

@router.get("/operarios", response_model=List[PersonalPlantaOut])
def list_operarios(
    cargo: Optional[int] = Query(default=None, description="Filtrar por id de cargo"),
    mecanicos_only: bool = Query(default=False, description="Solo operarios con cargo Mecanico"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Lista personal activo de la planta. Usado para selectores en formularios."""
    from models.production import PersonalPlanta
    from sqlalchemy import text

    q = db.query(PersonalPlanta).filter(PersonalPlanta.estado == True)
    if cargo:
        q = q.filter(PersonalPlanta.cargo == cargo)
    if mecanicos_only:
        q = q.filter(PersonalPlanta.cargo == 3)  # Id 3 = Mecanico en dbo.cargos_planta
    personal = q.order_by(PersonalPlanta.Id).all()

    # Obtener nombres de cargos en un solo query
    cargo_map = {}
    from sqlalchemy import text
    rows = db.execute(text("SELECT Id, nombre_cargo FROM dbo.cargos_planta")).fetchall()
    for row in rows:
        cargo_map[row[0]] = row[1]

    return [
        PersonalPlantaOut(
            Id=p.Id,
            nombre_operario=p.nombre_operario,
            cargo=p.cargo,
            cargo_nombre=cargo_map.get(p.cargo),
        )
        for p in personal
    ]


# ── registros de producción ──────────────────────────────────

@router.get("/registros", response_model=dict)
def list_registros(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    maquina_id: Optional[int] = None,
    numero_op: Optional[int] = None,
    fecha: Optional[date] = Query(default=None, description="Filtrar por fecha (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(RegistroProduccion)
    if maquina_id:
        q = q.filter(RegistroProduccion.maquina == maquina_id)
    if numero_op:
        q = q.filter(RegistroProduccion.numero_op == numero_op)
    if fecha:
        q = q.filter(cast(RegistroProduccion.fecha, Date) == fecha)

    total = q.count()
    registros = q.order_by(RegistroProduccion.fecha.desc()).offset((page - 1) * page_size).limit(page_size).all()
    items = [_registro_to_out(r, db) for r in registros]
    return {"total": total, "page": page, "page_size": page_size, "items": [i.model_dump() for i in items]}


@router.get("/registros/{registro_id}", response_model=RegistroProduccionOut)
def get_registro(registro_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    r = db.query(RegistroProduccion).filter(RegistroProduccion.Id == registro_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    return _registro_to_out(r, db)


@router.post("/registros", response_model=RegistroProduccionOut)
def create_registro(
    body: RegistroProduccionCreate,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    # Validar que la OP existe
    op = db.query(OpNumero).filter(OpNumero.docto == body.numero_op).first()
    if not op:
        raise HTTPException(status_code=404, detail=f"OP {body.numero_op} no encontrada")

    # Validar máquina
    if not db.query(Maquina).filter(Maquina.Id == body.maquina).first():
        raise HTTPException(status_code=404, detail="Máquina no encontrada")

    r = RegistroProduccion(
        created_at=datetime.now(),
        fecha=body.fecha,
        maquina=body.maquina,
        numero_op=body.numero_op,
        operario=body.operario,
        produccion=body.produccion,
        clase_b=body.clase_b,
        desecho=body.desecho,
        lider_turno=body.lider_turno,
        lote=body.lote,
        kg_lote=body.kg_lote,
        registro_siesa=0,   # pendiente de sincronización con SIESA
    )
    db.add(r)

    # Actualizar cant_consumida en op_numeros
    current = op.cant_consumida or 0
    op.cant_consumida = current + body.produccion
    db.commit()
    db.refresh(r)
    return _registro_to_out(r, db)
