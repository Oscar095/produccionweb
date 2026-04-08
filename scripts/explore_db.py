"""
Script de exploración del esquema de base de datos — KOS Xpress
Conecta a Azure SQL Server y extrae el esquema completo.
"""
import os
import re
import pyodbc

# Parsear CONN_STRING_SQL del .env
def parse_conn_string(conn_str: str) -> dict:
    params = {}
    for part in conn_str.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            params[k.strip()] = v.strip()
    return params

env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
conn_str_raw = ""
with open(env_path) as f:
    for line in f:
        line = line.strip()
        if line.startswith("CONN_STRING_SQL="):
            conn_str_raw = line[len("CONN_STRING_SQL="):]

p = parse_conn_string(conn_str_raw)

server   = p.get("Data Source", "")
database = p.get("Initial Catalog", "")
user     = p.get("User ID", "")
password = p.get("Password", "")

conn_str = (
    f"DRIVER={{ODBC Driver 17 for SQL Server}};"
    f"SERVER={server};"
    f"DATABASE={database};"
    f"UID={user};"
    f"PWD={password};"
    f"Encrypt=yes;"
    f"TrustServerCertificate=no;"
    f"Connection Timeout=30;"
)

print(f"\n{'='*60}")
print(f"Conectando a: {server} / {database}")
print(f"{'='*60}\n")

conn = pyodbc.connect(conn_str)
cursor = conn.cursor()

# ── 1. TABLAS ──────────────────────────────────────────────────
print("## 1. TABLAS DEL ESQUEMA\n")
cursor.execute("""
    SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
""")
tables = cursor.fetchall()
table_names = []
for row in tables:
    print(f"  [{row.TABLE_SCHEMA}].[{row.TABLE_NAME}]")
    table_names.append((row.TABLE_SCHEMA, row.TABLE_NAME))
print(f"\nTotal: {len(tables)} tablas\n")

# ── 2. COLUMNAS ────────────────────────────────────────────────
print("## 2. COLUMNAS POR TABLA\n")
table_name_list = ", ".join(f"'{t[1]}'" for t in table_names)
cursor.execute(f"""
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE,
           CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN ({table_name_list})
    ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
""")
columns = cursor.fetchall()

current_table = None
for col in columns:
    tbl = f"[{col.TABLE_SCHEMA}].[{col.TABLE_NAME}]"
    if tbl != current_table:
        if current_table is not None:
            print()
        print(f"  ### {tbl}")
        current_table = tbl
    nullable = "NULL" if col.IS_NULLABLE == "YES" else "NOT NULL"
    length = f"({col.CHARACTER_MAXIMUM_LENGTH})" if col.CHARACTER_MAXIMUM_LENGTH else ""
    default = f" DEFAULT {col.COLUMN_DEFAULT}" if col.COLUMN_DEFAULT else ""
    print(f"    - {col.COLUMN_NAME}: {col.DATA_TYPE}{length} {nullable}{default}")

# ── 3. CLAVES FORÁNEAS ─────────────────────────────────────────
print("\n\n## 3. RELACIONES / CLAVES FORÁNEAS\n")
cursor.execute("""
    SELECT
        FK.TABLE_NAME AS FK_Table,
        CU.COLUMN_NAME AS FK_Column,
        PK.TABLE_NAME AS PK_Table,
        PT.COLUMN_NAME AS PK_Column,
        RC.CONSTRAINT_NAME
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS RC
    JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS FK
        ON FK.CONSTRAINT_NAME = RC.CONSTRAINT_NAME
    JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS PK
        ON PK.CONSTRAINT_NAME = RC.UNIQUE_CONSTRAINT_NAME
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE CU
        ON CU.CONSTRAINT_NAME = FK.CONSTRAINT_NAME
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE PT
        ON PT.CONSTRAINT_NAME = PK.CONSTRAINT_NAME
    ORDER BY FK.TABLE_NAME
""")
fks = cursor.fetchall()
if fks:
    for fk in fks:
        print(f"  {fk.FK_Table}.{fk.FK_Column} -> {fk.PK_Table}.{fk.PK_Column}")
else:
    print("  (Sin claves foráneas definidas formalmente)")

# ── 4. MUESTRA DE DATOS ────────────────────────────────────────
print("\n\n## 4. MUESTRA DE DATOS (TOP 5 por tabla)\n")
for schema, table in table_names:
    print(f"  ### [{schema}].[{table}]")
    try:
        cursor.execute(f"SELECT TOP 5 * FROM [{schema}].[{table}]")
        rows = cursor.fetchall()
        if not rows:
            print("    (sin datos)")
        else:
            cols = [desc[0] for desc in cursor.description]
            print(f"    Columnas: {', '.join(cols)}")
            for i, row in enumerate(rows, 1):
                vals = []
                for v in row:
                    s = str(v)
                    vals.append(s[:50] + "..." if len(s) > 50 else s)
                print(f"    [{i}] {' | '.join(vals)}")
    except Exception as e:
        print(f"    ERROR: {e}")
    print()

cursor.close()
conn.close()
print("\n" + "="*60)
print("Exploración completada.")
print("="*60)
