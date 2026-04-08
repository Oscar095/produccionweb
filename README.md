# KOS Xpress — Sistema de Planeación de Producción

Plataforma MES que reemplaza AppSheet para la gestión y planeación de producción industrial.
Usa la misma base de datos Azure SQL Server (`kos_apps`) sin modificar las tablas existentes.

---

## Stack

| Capa | Tecnología |
|------|------------|
| Backend | Python 3.11, FastAPI, SQLAlchemy 2.0, bcrypt |
| Frontend | React 18, TypeScript, Tailwind CSS, Vite |
| Base de datos | Azure SQL Server (kos_apps) |
| Diagrama Gantt | Custom SVG con date-fns |
| Drag & Drop | @dnd-kit |
| Gráficas | Recharts |
| Auth | JWT (8h, duración de turno) |

---

## Requisitos

- Python 3.11 (Azure App Service)
- Node.js 18+
- ODBC Driver 17 o 18 for SQL Server

---

## Instalación

### 1. Clonar y configurar .env

```bash
git clone <repo>
cd produccionweb
```

Verifica que `.env` tenga:
```
CONN_STRING_SQL=Data Source=myappskos.database.windows.net;Initial Catalog=kos_apps;...
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
```

### 3. Frontend

```bash
cd frontend
npm install
```

---

## Configuración inicial de BD

El backend crea automáticamente el esquema `planeacion.*` al iniciar.
Opcionalmente, ejecuta el script completo en Azure Data Studio o sqlcmd:

```bash
sqlcmd -S myappskos.database.windows.net -U kos -P "password" \
       -d kos_apps -i migrations/001_create_planeacion_schema.sql
```

**Usuario admin inicial:** `admin` / `admin123` — **CAMBIAR en producción**

Para cambiar la contraseña:
```python
import bcrypt
print(bcrypt.hashpw(b'nueva_contraseña', bcrypt.gensalt()).decode())
# UPDATE planeacion.usuarios SET password_hash='...' WHERE username='admin'
```

---

## Desarrollo local

### Backend (desde `/backend`)
```bash
uvicorn main:app --reload --port 8000
# Swagger UI: http://localhost:8000/docs
```

### Frontend (desde `/frontend`)
```bash
npm run dev
# App: http://localhost:5173
```

Ajusta la URL del API en `frontend/.env`:
```
VITE_API_URL=http://localhost:8000
```

---

## Docker (producción)

```bash
docker-compose up --build
# Backend: http://localhost:8000/docs
# Frontend: http://localhost:3000
```

---

## Módulos

| Ruta | Módulo | Descripción |
|------|--------|-------------|
| `/dashboard` | Dashboard | KPIs en tiempo real, alertas de paradas, capacidad semanal |
| `/orders` | Órdenes | Listado completo con búsqueda y filtros |
| `/gantt` | Gantt | Diagrama de capacidad interactivo por máquina y semana |
| `/planning` | Planeación | Tablero drag & drop para asignar y priorizar órdenes |
| `/maintenance` | Mantenimiento | Tickets de mantenimiento y paradas de máquina |
| `/reports` | Reportes | Resumen semanal con exportación PDF |

---

## API Endpoints principales

```
POST   /api/auth/login                    → JWT token
GET    /api/production/kpis               → KPIs generales
GET    /api/production/orders             → Lista órdenes (paginado)
GET    /api/production/centers            → Máquinas/centros de trabajo
GET    /api/gantt?desde=&hasta=&centros=  → Datos del Gantt
GET    /api/planning/board?semana=        → Tablero por máquina
POST   /api/planning/asignaciones         → Asignar OP a máquina
PATCH  /api/planning/prioridades          → Drag & drop (bulk update)
GET    /api/planning/feasibility/{id}     → Factibilidad de la semana
GET    /api/maintenance/tickets           → Tickets de mantenimiento
POST   /api/reports/weekly/generate       → Generar PDF resumen semanal
```

Documentación completa: `http://localhost:8000/docs`

---

## Estructura del proyecto

```
produccionweb/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── database.py          # Conexión Azure SQL Server
│   ├── auth.py              # JWT + bcrypt
│   ├── models/              # SQLAlchemy (dbo.* solo lectura, planeacion.* escritura)
│   ├── schemas/             # Pydantic v2
│   ├── routers/             # Endpoints por módulo
│   ├── services/            # Lógica de negocio (Gantt, planning engine, PDF)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/           # Dashboard, Gantt, Planning, Maintenance, Reports, Orders
│   │   ├── components/      # Layout, componentes reutilizables
│   │   ├── api/             # Clientes axios por módulo
│   │   └── store/           # Zustand (auth state)
│   └── package.json
├── migrations/
│   └── 001_create_planeacion_schema.sql
├── scripts/
│   └── explore_db.py        # Script de exploración de esquema BD
├── docker-compose.yml
└── .env                     # CONN_STRING_SQL (no commitear)
```

---

## Modelo de datos nuevas tablas (`planeacion.*`)

```sql
planeacion.usuarios            -- Auth JWT: username, password_hash, rol (admin/supervisor/operador)
planeacion.asignaciones        -- OP → máquina + fecha_inicio_plan + fecha_fin_plan + prioridad
planeacion.paradas_programadas -- Paradas preventivas manuales (inicio, fin, motivo)
planeacion.resumen_semanal     -- Historial de PDFs generados
```

Las tablas `dbo.*` de AppSheet se acceden en **solo lectura**. AppSheet sigue funcionando sin cambios.

---

## Roles

| Rol | Permisos |
|-----|----------|
| `admin` | Todo, incluyendo crear usuarios |
| `supervisor` | Asignar órdenes, suspender, generar reportes, registrar paradas |
| `operador` | Solo lectura (dashboard, gantt, órdenes, mantenimiento) |
