"""Historial local en SQLite y deteccion de novedades.

Guarda la ultima fotografia conocida de la agenda, mensajes, circulares
y horario; al comparar contra los datos actuales genera "novedades"
(tarea nueva, nota registrada, mensaje nuevo, etc.) que la app muestra
en la campana de notificaciones.
"""

import hashlib
import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "historial.db"


class Historial:
    def __init__(self, db_path=DB_PATH):
        # FastAPI ejecuta los endpoints en threads del pool: se permite uso
        # entre hilos y se serializan las escrituras con un lock.
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._crear_tablas()

    def _crear_tablas(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS actividades (
                id TEXT PRIMARY KEY,
                materia TEXT, titulo TEXT, calificacion TEXT,
                fecha_inicio TEXT, fecha_fin TEXT, estado TEXT,
                periodo_codi TEXT
            );
            CREATE TABLE IF NOT EXISTS mensajes (
                id TEXT PRIMARY KEY,
                asunto TEXT, remitente TEXT, fecha TEXT
            );
            CREATE TABLE IF NOT EXISTS circulares (
                clave TEXT PRIMARY KEY,
                titulo TEXT, fecha TEXT
            );
            CREATE TABLE IF NOT EXISTS horario (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                hash TEXT
            );
            CREATE TABLE IF NOT EXISTS novedades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT, tipo TEXT, texto TEXT,
                leida INTEGER DEFAULT 0
            );
        """)
        self.conn.commit()

    # ------------------------------------------------------------------ #
    # Deteccion de novedades
    # ------------------------------------------------------------------ #
    def detectar(self, agenda, mensajes, circulares, horario):
        """Compara los datos actuales con el historial.

        Devuelve la lista de novedades nuevas encontradas (tambien quedan
        registradas en la tabla novedades). La primera ejecucion solo
        siembra el historial, sin generar ruido.
        """
        with self._lock:
            return self._detectar(agenda, mensajes, circulares, horario)

    def _detectar(self, agenda, mensajes, circulares, horario):
        nuevas = []
        primera_vez = not self.conn.execute(
            "SELECT 1 FROM actividades LIMIT 1").fetchone()
        ahora = datetime.now().isoformat(timespec="seconds")

        def registrar(tipo, texto):
            nuevas.append({"tipo": tipo, "texto": texto})
            self.conn.execute(
                "INSERT INTO novedades (ts, tipo, texto) VALUES (?,?,?)",
                (ahora, tipo, texto))

        # ---- Actividades y notas ----
        guardadas = {
            r["id"]: r for r in self.conn.execute("SELECT * FROM actividades")
        }
        for ev in agenda:
            if not ev["id"]:
                continue
            prev = guardadas.get(ev["id"])
            if primera_vez:
                self._guardar_actividad(ev)
            elif prev is None:
                registrar("tarea_nueva",
                          f"Nueva actividad: {ev['materia']} — "
                          f"{ev['titulo']} ({ev['fecha_inicio']})")
                self._guardar_actividad(ev)
            elif prev["calificacion"] != (ev["calificacion"] or None):
                if not prev["calificacion"] and ev["calificacion"]:
                    registrar("nota_nueva",
                              f"Nota registrada: {ev['materia']} — "
                              f"{ev['titulo']}: {ev['calificacion']}")
                else:
                    registrar("nota_cambiada",
                              f"Nota actualizada: {ev['materia']} — "
                              f"{ev['titulo']}: "
                              f"{prev['calificacion']} → {ev['calificacion']}")
                self._guardar_actividad(ev)
            elif (prev["fecha_inicio"] != (ev["fecha_inicio"] or None)
                  or prev["fecha_fin"] != (ev["fecha_fin"] or None)):
                registrar("fecha_cambiada",
                          f"Actividad reprogramada: {ev['materia']} — "
                          f"{ev['titulo']}: {prev['fecha_inicio'] or '?'} → "
                          f"{ev['fecha_inicio'] or '?'}")
                self._guardar_actividad(ev)

        # ---- Mensajes ----
        conocidos = {r["id"] for r in
                     self.conn.execute("SELECT id FROM mensajes")}
        for m in mensajes:
            if not m["id"]:
                continue
            if m["id"] not in conocidos:
                if not primera_vez:
                    registrar("mensaje_nuevo",
                              f"Mensaje nuevo: {m['asunto']} ({m['remitente']})")
                self.conn.execute(
                    "INSERT OR REPLACE INTO mensajes VALUES (?,?,?,?)",
                    (m["id"], m["asunto"], m["remitente"], m["fecha"]))

        # ---- Circulares ----
        conocidas = {r["clave"] for r in
                     self.conn.execute("SELECT clave FROM circulares")}
        for c in circulares:
            clave = f"{c['titulo']}|{c['fecha']}"
            if clave not in conocidas:
                if not primera_vez:
                    registrar("circular_nueva", f"Circular nueva: {c['titulo']}")
                self.conn.execute(
                    "INSERT OR REPLACE INTO circulares VALUES (?,?,?)",
                    (clave, c["titulo"], c["fecha"]))

        # ---- Horario ----
        hash_actual = hashlib.sha256(
            json.dumps(horario, sort_keys=True).encode()).hexdigest()
        fila = self.conn.execute(
            "SELECT hash FROM horario WHERE id=1").fetchone()
        if fila is None:
            self.conn.execute("INSERT INTO horario VALUES (1,?)",
                              (hash_actual,))
        elif fila["hash"] != hash_actual:
            registrar("horario_cambiado", "Tu horario de clases cambió")
            self.conn.execute("UPDATE horario SET hash=? WHERE id=1",
                              (hash_actual,))

        self.conn.commit()
        return nuevas

    def _guardar_actividad(self, ev):
        self.conn.execute(
            "INSERT OR REPLACE INTO actividades VALUES (?,?,?,?,?,?,?,?)",
            (ev["id"], ev["materia"], ev["titulo"], ev["calificacion"],
             ev["fecha_inicio"], ev["fecha_fin"], ev["estado"],
             ev.get("periodo_codi", "")))

    # ------------------------------------------------------------------ #
    # Consulta de novedades
    # ------------------------------------------------------------------ #
    def listar_novedades(self, solo_no_leidas=False, limite=50):
        with self._lock:
            sql = ("SELECT id, ts, tipo, texto, leida FROM novedades "
                   + ("WHERE leida=0 " if solo_no_leidas else "")
                   + "ORDER BY id DESC LIMIT ?")
            filas = [dict(r) for r in
                     self.conn.execute(sql, (limite,)).fetchall()]
            no_leidas = self.conn.execute(
                "SELECT COUNT(*) AS n FROM novedades WHERE leida=0"
            ).fetchone()["n"]
            return {"no_leidas": no_leidas, "novedades": filas}

    def marcar_leidas(self, ids=None):
        with self._lock:
            if ids:
                self.conn.executemany(
                    "UPDATE novedades SET leida=1 WHERE id=?",
                    [(i,) for i in ids])
            else:
                self.conn.execute("UPDATE novedades SET leida=1")
            self.conn.commit()
