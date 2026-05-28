from datetime import datetime, date, timedelta
from calendar import monthrange
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import or_, func, cast, Date, String
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_roles
from models.production import OpNumero, RegistroProduccion, Maquina, CentroCostos, PersonalPlanta
from models.maintenance import SolicitudMantenimiento
from models.planning import Asignacion
from services.working_hours import operative_hours_between
from services.indicadores_service import compute_tasa_servicio
from schemas.production import (
    OpNumeroOut, KPIProduccionOut, MaquinaOut, CentroCostosOut,
    RegistroProduccionCreate, RegistroProduccionOut, PersonalPlantaOut,
    EquipmentAvailabilityOut, MaquinaAvailabilityOut, PeriodoOut,
    EquipmentEfficiencyOut, MaquinaEficienciaOut,
    EquipmentQualityOut, MaquinaCalidadOut,
    EquipmentOEEOut, MaquinaOEEOut,
)

router = APIRouter(prefix="/api/production", tags=["production"])

# tipo_inv del "producto real" dentro de los 3 componentes de una OP.
# Los otros dos son productos en proceso (identificados por centro de costos).
TIPO_INV_PRODUCTO_REAL = "1430K.ex"


# ── helpers ─────────────────────────────────────────────────

def _horas_habiles(ini: datetime, fin: datetime) -> float:
    """
    Horas entre ini y fin EXCLUYENDO los tramos que caen en domingo.
    La planta no opera los domingos, así que esas horas no estaban
    disponibles para producir y no deben contar como parada
    (consistente con 'días trabajados', que tampoco incluye domingos).
    """
    if fin <= ini:
        return 0.0
    total = 0.0
    cur = ini
    while cur < fin:
        siguiente_dia = cur.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        seg_fin = min(siguiente_dia, fin)
        if cur.weekday() != 6:  # weekday(): lunes=0 … domingo=6
            total += (seg_fin - cur).total_seconds() / 3600.0
        cur = seg_fin
    return total


def _registro_to_out(r: RegistroProduccion, db: Session) -> RegistroProduccionOut:
    maq = db.query(Maquina).filter(Maquina.Id == r.maquina).first()
    # Preferir fila del producto real (tipo_inv='1430K.ex') entre los 3 componentes.
    op = (
        db.query(OpNumero)
        .filter(OpNumero.docto == r.numero_op, OpNumero.tipo_inv.like(f'%{TIPO_INV_PRODUCTO_REAL}%'))
        .first()
        or db.query(OpNumero).filter(OpNumero.docto == r.numero_op).first()
    )
    oper = db.query(PersonalPlanta).filter(PersonalPlanta.Id == r.operario).first()
    lider = db.query(PersonalPlanta).filter(PersonalPlanta.Id == r.lider_turno).first()
    return RegistroProduccionOut(
        Id=r.Id,
        fecha=r.fecha,
        maquina=r.maquina,
        maquina_nombre=maq.nombre if maq else None,
        numero_op=r.numero_op,
        item=op.item if op else None,
        marca=op.marca if op else None,
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
    page_size: int = Query(default=50, ge=1, le=2000),
    estado: Optional[str] = Query(default=None),
    buscar: Optional[str] = Query(default=None),
    tipo_inv: Optional[str] = Query(
        default=None,
        description="Filtrar por tipo_inv (p.ej. '1430K.ex' para solo productos reales)",
    ),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(OpNumero)
    if tipo_inv:
        q = q.filter(OpNumero.tipo_inv.like(f'%{tipo_inv}%'))
    if buscar:
        like = f"%{buscar}%"
        q = q.filter(
            or_(
                OpNumero.item.like(like),
                OpNumero.marca.like(like),
                OpNumero.ext1.like(like),
                OpNumero.ext2.like(like),
                OpNumero.lote.like(like),
                OpNumero.cod_barras.like(like),
                OpNumero.und_medida.like(like),
                OpNumero.tipo_inv.like(like),
                OpNumero.docto == (int(buscar) if buscar.isdigit() else -1),
            )
        )
    total = q.count()
    ops = q.order_by(OpNumero.docto.desc()).offset((page - 1) * page_size).limit(page_size).all()
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
    ops = db.query(OpNumero).filter(OpNumero.tipo_inv.like('%1430K.ex%')).all()
    total = len(ops)
    completadas = sum(1 for o in ops if (o.cant_consumida or 0) >= (o.cantidad or 1))
    en_proceso  = sum(1 for o in ops if 0 < (o.cant_consumida or 0) < (o.cantidad or 1))
    pendientes  = sum(1 for o in ops if (o.cant_consumida or 0) <= 0)
    asignadas_doctos = {a.op_docto for a in db.query(Asignacion.op_docto).filter(Asignacion.suspendida == False).all()}
    sin_asignar = sum(1 for o in ops if o.docto not in asignadas_doctos and (o.cant_consumida or 0) < (o.cantidad or 1))
    pct = round(completadas / total * 100, 1) if total else 0.0

    hoy = date.today()
    primer_dia_dt = datetime(hoy.year, hoy.month, 1)
    ultimo_dia_dt = datetime(hoy.year, hoy.month, monthrange(hoy.year, hoy.month)[1], 23, 59, 59)
    tasa_servicio, mes_total, mes_atrasadas = compute_tasa_servicio(db, primer_dia_dt, ultimo_dia_dt, None)

    return KPIProduccionOut(
        total_ordenes=total, completadas=completadas, en_proceso=en_proceso,
        pendientes=pendientes, sin_asignar=sin_asignar, pct_completado=pct,
        mes_total=mes_total, mes_atrasadas=mes_atrasadas, tasa_servicio=tasa_servicio,
    )


@router.get("/equipment-availability", response_model=EquipmentAvailabilityOut)
def get_equipment_availability(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """
    Disponibilidad por máquina = (horas_hábiles − horas_parada) / horas_hábiles
    Período: mes en curso (día 1 → hoy). Las horas hábiles son las horas L-V
    transcurridas del mes (planta opera 24h L-V, sábado y domingo se excluyen).
    Esto da la MISMA base horaria a todas las máquinas; la diferencia entre
    máquinas viene solo de los tickets de mantenimiento.
    """
    from services.indicadores_service import compute_disponibilidad

    hoy = datetime.now()
    primer_dia = datetime(hoy.year, hoy.month, 1)
    valor_global, por_maquina, horas_disp_total, horas_parada_total = compute_disponibilidad(
        db, primer_dia, hoy, maquina_id=None
    )

    return EquipmentAvailabilityOut(
        disponibilidad_pct=valor_global,
        horas_disponibles_total=round(horas_disp_total, 1),
        horas_parada_total=round(horas_parada_total, 1),
        maquinas_evaluadas=len(por_maquina),
        periodo=PeriodoOut(inicio=primer_dia.date(), fin=hoy.date()),
        por_maquina=por_maquina,
    )


@router.get("/equipment-efficiency", response_model=EquipmentEfficiencyOut)
def get_equipment_efficiency(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """
    Eficiencia (Rendimiento) por máquina = producción real / producción teórica.

        producción real     = SUM(produccion + clase_b + desecho)  (throughput total)
        producción teórica  = capacidad_hora × horas_operativas
        horas_operativas    = horas_hábiles_mes − horas_parada_mantenimiento

    horas_hábiles_mes son las horas L-V transcurridas del mes (planta opera
    24h L-V). Se aplica la MISMA base horaria a todas las máquinas, por lo
    que la diferencia entre máquinas solo proviene de su throughput real y
    sus paradas registradas.
    """
    from services.indicadores_service import compute_eficiencia

    hoy = datetime.now()
    primer_dia = datetime(hoy.year, hoy.month, 1)
    valor_global, por_maquina, prod_real_total, prod_teorica_total = compute_eficiencia(
        db, primer_dia, hoy, maquina_id=None
    )

    return EquipmentEfficiencyOut(
        eficiencia_pct=valor_global,
        produccion_real_total=prod_real_total,
        produccion_teorica_total=round(prod_teorica_total, 1),
        maquinas_evaluadas=len(por_maquina),
        periodo=PeriodoOut(inicio=primer_dia.date(), fin=hoy.date()),
        por_maquina=por_maquina,
    )


@router.get("/equipment-quality", response_model=EquipmentQualityOut)
def get_equipment_quality(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """
    Calidad por máquina = producción buena / producción total.

        producción buena  = SUM(produccion)
        producción total  = SUM(produccion + clase_b + desecho)

    Es el 3er pilar del OEE (Disponibilidad × Rendimiento × Calidad). Período:
    mes en curso (día 1 → hoy). Solo se basa en dbo.registro_produccion.
    """
    from services.indicadores_service import compute_calidad

    hoy = datetime.now()
    primer_dia = datetime(hoy.year, hoy.month, 1)
    valor_global, por_maquina, buena_total, produccion_total = compute_calidad(
        db, primer_dia, hoy, maquina_id=None
    )

    return EquipmentQualityOut(
        calidad_pct=valor_global,
        produccion_buena_total=buena_total,
        produccion_total=produccion_total,
        maquinas_evaluadas=len(por_maquina),
        periodo=PeriodoOut(inicio=primer_dia.date(), fin=hoy.date()),
        por_maquina=por_maquina,
    )


@router.get("/equipment-oee", response_model=EquipmentOEEOut)
def get_equipment_oee(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """
    OEE (Overall Equipment Effectiveness) = Disponibilidad × Rendimiento × Calidad.

    Indicador compuesto que sintetiza los 3 pilares en uno solo. Período: mes
    en curso. Reusa los handlers de /equipment-{availability,efficiency,quality}
    para garantizar consistencia con esos endpoints; el OEE global es el
    producto de los tres globales, y el OEE por máquina se calcula solo para
    máquinas que aparecen en los 3 pilares.
    """
    disp = get_equipment_availability(db=db, _=None)
    rend = get_equipment_efficiency(db=db, _=None)
    cal  = get_equipment_quality(db=db, _=None)

    disp_map = {m.maquina_id: m for m in disp.por_maquina}
    rend_map = {m.maquina_id: m for m in rend.por_maquina}
    cal_map  = {m.maquina_id: m for m in cal.por_maquina}

    maquina_ids = set(disp_map) & set(rend_map) & set(cal_map)

    por_maquina: list[MaquinaOEEOut] = []
    for mid in maquina_ids:
        d = disp_map[mid].disponibilidad_pct
        r = rend_map[mid].eficiencia_pct
        c = cal_map[mid].calidad_pct
        oee_pct = round((d / 100.0) * (r / 100.0) * (c / 100.0) * 100, 1)
        por_maquina.append(MaquinaOEEOut(
            maquina_id=mid,
            maquina_nombre=disp_map[mid].maquina_nombre,
            disponibilidad_pct=d,
            rendimiento_pct=r,
            calidad_pct=c,
            oee_pct=oee_pct,
        ))
    por_maquina.sort(key=lambda x: x.oee_pct)

    oee_global = round(
        (disp.disponibilidad_pct / 100.0)
        * (rend.eficiencia_pct / 100.0)
        * (cal.calidad_pct / 100.0)
        * 100,
        1,
    )

    return EquipmentOEEOut(
        oee_pct=oee_global,
        disponibilidad_pct=disp.disponibilidad_pct,
        rendimiento_pct=rend.eficiencia_pct,
        calidad_pct=cal.calidad_pct,
        maquinas_evaluadas=len(por_maquina),
        periodo=disp.periodo,
        por_maquina=por_maquina,
    )


# ── centros de trabajo ───────────────────────────────────────

@router.get("/centers", response_model=List[MaquinaOut])
def list_centers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from models.maintenance import EstadoMaquina
    maquinas = (
        db.query(Maquina)
        .join(EstadoMaquina, EstadoMaquina.Id == Maquina.estado)
        .filter(func.lower(cast(EstadoMaquina.estado_descripcion, String(200))) != 'no disponible')
        .order_by(Maquina.Id)
        .all()
    )
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
    page_size: int = Query(default=100, ge=1, le=500),
    maquina_id: Optional[int] = None,
    numero_op: Optional[int] = None,
    fecha: Optional[date] = Query(default=None, description="Filtrar por fecha exacta (YYYY-MM-DD)"),
    fecha_inicio: Optional[date] = Query(default=None, description="Desde fecha (YYYY-MM-DD)"),
    fecha_fin: Optional[date] = Query(default=None, description="Hasta fecha (YYYY-MM-DD)"),
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
    if fecha_inicio:
        q = q.filter(cast(RegistroProduccion.fecha, Date) >= fecha_inicio)
    if fecha_fin:
        q = q.filter(cast(RegistroProduccion.fecha, Date) <= fecha_fin)

    total = q.count()
    registros = q.order_by(RegistroProduccion.fecha.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # Bulk fetch related entities to avoid N+1 queries
    maquina_ids = {r.maquina for r in registros}
    op_doctos = {r.numero_op for r in registros}
    personal_ids = {r.operario for r in registros} | {r.lider_turno for r in registros}

    maquinas_map = {m.Id: m for m in db.query(Maquina).filter(Maquina.Id.in_(maquina_ids)).all()} if maquina_ids else {}

    # Cada docto tiene 3 filas en op_numeros (los 3 componentes de la OP). Para item/marca
    # usamos siempre la fila del producto real (tipo_inv='1430K.ex'); los otros dos son
    # productos en proceso identificables por centro de costos.
    ops_map: dict[int, OpNumero] = {}
    if op_doctos:
        for op in db.query(OpNumero).filter(OpNumero.docto.in_(op_doctos)).all():
            existing = ops_map.get(op.docto)
            is_real_product = op.tipo_inv and op.tipo_inv.lower() == TIPO_INV_PRODUCTO_REAL.lower()
            existing_is_real = existing and existing.tipo_inv and existing.tipo_inv.lower() == TIPO_INV_PRODUCTO_REAL.lower()
            if existing is None or (is_real_product and not existing_is_real):
                ops_map[op.docto] = op

    personal_map = {p.Id: p for p in db.query(PersonalPlanta).filter(PersonalPlanta.Id.in_(personal_ids)).all()} if personal_ids else {}

    items = []
    for r in registros:
        maq = maquinas_map.get(r.maquina)
        op = ops_map.get(r.numero_op)
        oper = personal_map.get(r.operario)
        lider = personal_map.get(r.lider_turno)
        items.append(RegistroProduccionOut(
            Id=r.Id,
            fecha=r.fecha,
            maquina=r.maquina,
            maquina_nombre=maq.nombre if maq else None,
            numero_op=r.numero_op,
            item=op.item if op else None,
            marca=op.marca if op else None,
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
        ))

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
