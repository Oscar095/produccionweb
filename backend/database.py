"""
Conexión SQLAlchemy a Azure SQL Server (kos_apps).
Parsea CONN_STRING_SQL del .env y crea el engine con pool_pre_ping para Azure.
"""
import os
import re
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv

load_dotenv()

Base = declarative_base()


def _parse_conn_string(conn_str: str) -> dict:
    """Convierte ADO.NET connection string a dict de parámetros."""
    params = {}
    for part in conn_str.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            params[k.strip().lower()] = v.strip()
    return params


def _build_sqlalchemy_url() -> str:
    raw = os.getenv("CONN_STRING_SQL", "")
    if not raw:
        raise ValueError("CONN_STRING_SQL no definida en .env")

    p = _parse_conn_string(raw)
    server   = p.get("data source", "")
    database = p.get("initial catalog", "")
    user     = p.get("user id", "")
    password = p.get("password", "")

    # Reemplazar caracteres especiales en password para URL
    from urllib.parse import quote_plus
    password_enc = quote_plus(password)
    user_enc     = quote_plus(user)

    driver = "ODBC+Driver+17+for+SQL+Server"
    url = (
        f"mssql+pyodbc://{user_enc}:{password_enc}@{server}/{database}"
        f"?driver={driver}&Encrypt=yes&TrustServerCertificate=no"
    )
    return url


engine = create_engine(
    _build_sqlalchemy_url(),
    pool_pre_ping=True,      # reconectar si la conexión cae (Azure cierra idle connections)
    pool_recycle=1800,       # reciclar conexiones cada 30 min
    pool_size=5,
    max_overflow=10,
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db():
    """Dependency de FastAPI para inyectar sesión de BD."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
