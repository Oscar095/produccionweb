import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_roles
from models.planning import ResumenSemanal, Usuario
from services.report_service import build_weekly_summary, generate_pdf

router = APIRouter(prefix="/api/reports", tags=["reports"])

PDF_DIR = os.path.join(os.path.dirname(__file__), "..", "pdfs")


@router.get("/weekly")
def get_weekly_data(
    semana: Optional[datetime] = Query(default=None, description="Lunes de la semana"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if semana is None:
        hoy = datetime.utcnow().date()
        lunes = hoy - timedelta(days=hoy.weekday())
        semana = datetime.combine(lunes, datetime.min.time())
    return build_weekly_summary(db, semana)


@router.post("/weekly/generate")
def generate_weekly_pdf(
    semana: Optional[datetime] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles("admin", "supervisor")),
):
    if semana is None:
        hoy = datetime.utcnow().date()
        lunes = hoy - timedelta(days=hoy.weekday())
        semana = datetime.combine(lunes, datetime.min.time())

    filename = f"resumen_{semana.strftime('%Y-%m-%d')}.pdf"
    path = os.path.join(PDF_DIR, filename)

    try:
        generate_pdf(db, semana, path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generando PDF: {e}")

    semana_fin = semana + timedelta(days=6, hours=23, minutes=59)
    registro = ResumenSemanal(
        semana_inicio=semana,
        semana_fin=semana_fin,
        generado_por=current_user.id,
        pdf_path=path,
    )
    db.add(registro)
    db.commit()

    return FileResponse(
        path=path,
        media_type="application/pdf",
        filename=filename,
    )


@router.get("/weekly/history")
def report_history(db: Session = Depends(get_db), _=Depends(get_current_user)):
    registros = db.query(ResumenSemanal).order_by(ResumenSemanal.generado_at.desc()).limit(20).all()
    return [
        {
            "id": r.id,
            "semana_inicio": r.semana_inicio.isoformat(),
            "semana_fin": r.semana_fin.isoformat(),
            "generado_at": r.generado_at.isoformat(),
            "enviado": r.enviado,
        }
        for r in registros
    ]
