"""Snapshots persistentes de datos de Educalinks por usuario.

Cuando Educalinks responde, cada endpoint guarda el resultado en SQLite
(asesinando el cache en memoria que se pierde al reiniciar Render). Cuando
Educalinks está caído, los endpoints sirven el último snapshot guardado
con una cabecera X-Snapshot indicando la edad del dato.

Esto hace que EducaFix sea MAS confiable que Educalinks mismo: si el
portal del colegio cae, el estudiante sigue viendo sus últimas notas,
tareas y horario desde nuestro servidor.
"""

import json
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "snapshots.db"
MAX_EDAD_DIAS = 60  # snapshots más viejos que esto se descartan


class SnapshotStore:
    def __init__(self, db_path=DB_PATH):
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._crear_tabla()

    def _crear_tabla(self):
        with self._lock:
            self.conn.executescript("""
                CREATE TABLE IF NOT EXISTS snapshots (
                    usuario TEXT NOT NULL,
                    perfil TEXT NOT NULL DEFAULT 'alumno',
                    clave TEXT NOT NULL,
                    datos TEXT NOT NULL,
                    ts REAL NOT NULL,
                    PRIMARY KEY (usuario, perfil, clave)
                )
            """)
            self.conn.commit()

    def guardar(self, usuario, perfil, clave, datos):
        """Guarda un snapshot (reemplaza el anterior de la misma clave)."""
        with self._lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?)",
                (usuario, perfil, clave, json.dumps(datos, ensure_ascii=False),
                 time.time()))
            self.conn.commit()

    def cargar(self, usuario, perfil, clave, max_edad_dias=MAX_EDAD_DIAS):
        """Devuelve (datos, ts) del snapshot o None si no existe/es muy viejo."""
        with self._lock:
            fila = self.conn.execute(
                "SELECT datos, ts FROM snapshots "
                "WHERE usuario=? AND perfil=? AND clave=?",
                (usuario, perfil, clave)).fetchone()
        if not fila:
            return None
        edad = time.time() - fila["ts"]
        if edad > max_edad_dias * 86400:
            return None
        try:
            return json.loads(fila["datos"]), fila["ts"]
        except (json.JSONDecodeError, TypeError):
            return None

    def edad(self, usuario, perfil, clave):
        """Devuelve la edad en segundos del snapshot más reciente, o None."""
        with self._lock:
            fila = self.conn.execute(
                "SELECT ts FROM snapshots "
                "WHERE usuario=? AND perfil=? AND clave=?",
                (usuario, perfil, clave)).fetchone()
        return (time.time() - fila["ts"]) if fila else None

    def limpiar_viejos(self, max_edad_dias=MAX_EDAD_DIAS):
        with self._lock:
            corte = time.time() - max_edad_dias * 86400
            self.conn.execute("DELETE FROM snapshots WHERE ts < ?", (corte,))
            self.conn.commit()


snapshots = SnapshotStore()
