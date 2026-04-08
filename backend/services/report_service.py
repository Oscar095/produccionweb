"""
Servicio de generación de resúmenes semanales en PDF (ReportLab).
"""
import os
from datetime import datetime, timedelta
from typing import List
from sqlalchemy.orm import Session

from models.production import Maquina, OpNumero
from models.planning import Asignacion, ResumenSemanal
from services.planning_engine import get_capacidad_semana, get_feasibility


def _get_week_bounds(semana_inicio: datetime):
    lunes = semana_inicio.replace(hour=0, minute=0, second=0, microsecond=0)
    viernes = lunes + timedelta(days=4, hours=23, minutes=59, seconds=59)
    return lunes, viernes


def build_weekly_summary(db: Session, semana_inicio: datetime) -> dict:
    """Construye los datos del resumen semanal (JSON, sin PDF)."""
    lunes, viernes = _get_week_bounds(semana_inicio)
    capacidades = get_capacidad_semana(db, lunes)

    asignaciones_semana = (
        db.query(Asignacion)
        .filter(
            Asignacion.suspendida == False,
            Asignacion.fecha_inicio_plan <= viernes,
            Asignacion.fecha_fin_plan >= lunes,
        )
        .order_by(Asignacion.prioridad.asc())
        .all()
    )

    op_doctos = [a.op_docto for a in asignaciones_semana]
    ops = {}
    if op_doctos:
        ops = {o.docto: o for o in db.query(OpNumero).filter(OpNumero.docto.in_(op_doctos)).all()}

    maquinas = {m.Id: m for m in db.query(Maquina).all()}

    ordenes_semana = []
    ordenes_riesgo = []

    for cap in capacidades:
        result = get_feasibility(db, cap.maquina_id, lunes)
        for item in result["alcanzables"]:
            op = ops.get(item["op_docto"])
            ordenes_semana.append({
                "maquina": cap.maquina_nombre,
                "op_docto": item["op_docto"],
                "item": item["item"],
                "horas_requeridas": item["horas_requeridas"],
                "estado": "Alcanzable",
            })
        for item in result["en_riesgo"]:
            op = ops.get(item["op_docto"])
            ordenes_riesgo.append({
                "maquina": cap.maquina_nombre,
                "op_docto": item["op_docto"],
                "item": item["item"],
                "horas_requeridas": item["horas_requeridas"],
                "horas_disponibles": item["horas_disponibles"],
                "estado": "En riesgo",
            })

    return {
        "semana_inicio": lunes.isoformat(),
        "semana_fin": viernes.isoformat(),
        "capacidades": [c.model_dump() for c in capacidades],
        "ordenes_semana": ordenes_semana,
        "ordenes_riesgo": ordenes_riesgo,
        "total_alcanzables": len(ordenes_semana),
        "total_en_riesgo": len(ordenes_riesgo),
    }


def generate_pdf(db: Session, semana_inicio: datetime, output_path: str) -> str:
    """Genera PDF del resumen semanal con ReportLab."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    except ImportError:
        raise RuntimeError("reportlab no instalado. Ejecuta: pip install reportlab")

    data = build_weekly_summary(db, semana_inicio)
    lunes, viernes = _get_week_bounds(semana_inicio)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    doc = SimpleDocTemplate(output_path, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []

    # Título
    story.append(Paragraph(
        f"Resumen Semanal — KOS Xpress",
        styles["Title"]
    ))
    story.append(Paragraph(
        f"Semana: {lunes.strftime('%d/%m/%Y')} al {viernes.strftime('%d/%m/%Y')}",
        styles["Heading2"]
    ))
    story.append(Spacer(1, 0.2 * inch))

    # Capacidades por máquina
    story.append(Paragraph("Capacidad por Máquina", styles["Heading2"]))
    cap_data = [["Máquina", "Horas Disponibles", "Horas Asignadas", "Paradas (h)", "Estado"]]
    for c in data["capacidades"]:
        estado = "SOBRECARGADA" if c["sobrecargada"] else "OK"
        cap_data.append([
            c["maquina_nombre"],
            f"{c['horas_disponibles_semana']:.1f}h",
            f"{c['horas_asignadas']:.1f}h",
            f"{c['horas_paradas']:.1f}h",
            estado,
        ])

    cap_table = Table(cap_data, colWidths=[2*inch, 1.3*inch, 1.3*inch, 1.3*inch, 1.1*inch])
    cap_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E40AF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0F4FF")]),
    ]))
    story.append(cap_table)
    story.append(Spacer(1, 0.3 * inch))

    # Órdenes alcanzables
    story.append(Paragraph(
        f"Órdenes que DEBEN completarse esta semana ({data['total_alcanzables']})",
        styles["Heading2"]
    ))
    if data["ordenes_semana"]:
        ord_data = [["Máquina", "OP", "Producto", "Horas Est."]]
        for o in data["ordenes_semana"]:
            ord_data.append([o["maquina"], str(o["op_docto"]), o["item"] or "-", f"{o['horas_requeridas']:.1f}h"])
        ord_table = Table(ord_data, colWidths=[1.8*inch, 0.8*inch, 3*inch, 1.2*inch])
        ord_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#166534")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0FFF4")]),
        ]))
        story.append(ord_table)
    else:
        story.append(Paragraph("Sin órdenes asignadas para esta semana.", styles["Normal"]))

    story.append(Spacer(1, 0.3 * inch))

    # Órdenes en riesgo
    story.append(Paragraph(
        f"Órdenes EN RIESGO — capacidad insuficiente ({data['total_en_riesgo']})",
        styles["Heading2"]
    ))
    if data["ordenes_riesgo"]:
        risk_data = [["Máquina", "OP", "Producto", "Horas Req.", "Horas Disp."]]
        for o in data["ordenes_riesgo"]:
            risk_data.append([
                o["maquina"], str(o["op_docto"]), o["item"] or "-",
                f"{o['horas_requeridas']:.1f}h", f"{o['horas_disponibles']:.1f}h",
            ])
        risk_table = Table(risk_data, colWidths=[1.5*inch, 0.8*inch, 2.5*inch, 1.2*inch, 1.2*inch])
        risk_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#991B1B")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FFF5F5")]),
        ]))
        story.append(risk_table)
    else:
        story.append(Paragraph("Sin órdenes en riesgo.", styles["Normal"]))

    story.append(Spacer(1, 0.5 * inch))
    story.append(Paragraph(
        f"Generado el {datetime.now().strftime('%d/%m/%Y %H:%M')} — KOS Xpress",
        styles["Normal"]
    ))

    doc.build(story)
    return output_path
