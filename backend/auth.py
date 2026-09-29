"""Autenticacion proxy contra Educalinks y sesiones por usuario.

El usuario ingresa sus credenciales de Educalinks en la app; el backend
las valida haciendo login real contra el portal (main_valid.php). Si
Educalinks acepta, se crea una sesion con su propio EducalinksClient
(cache aislada) y su propio historial de novedades.

Con "recuerdame" las credenciales se guardan CIFRADAS con Fernet en una
base local (la clave vive en backend/secret.key, nunca se sube a git).
"""

import hashlib
import secrets
import sqlite3
import threading
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Cookie, Depends, HTTPException

from historial import Historial
from scraper import EducalinksClient, EducalinksError

BASE_DIR = Path(__file__).resolve().parent
DB_SESIONES = BASE_DIR / "sesiones.db"
KEY_FILE = BASE_DIR / "secret.key"


class Sesion:
    """Sesion activa: cliente de Educalinks + historial del usuario."""

    def __init__(self, token, usuario, cliente, historial):
        self.token = token
        self.usuario = usuario
        self.cliente = cliente
        self.historial = historial


class Auth:
    def __init__(self, base=BASE_DIR, db=DB_SESIONES, key_file=KEY_FILE):
        self.base = base
        self.db = db
        self.key_file = key_file
        self._lock = threading.Lock()
        self._sesiones = {}  # token -> Sesion (solo en memoria)
        self._fernet = self._cargar_o_crear_clave()
        self._conn = sqlite3.connect(self.db, check_same_thread=False)
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS recordados ("
                "token TEXT PRIMARY KEY, usuario TEXT, cifrado TEXT, "
                "ts TEXT DEFAULT CURRENT_TIMESTAMP)")
            self._conn.commit()

    # ------------------------------------------------------------------ #
    # Cifrado de credenciales recordadas
    # ------------------------------------------------------------------ #
    def _cargar_o_crear_clave(self):
        if self.key_file.exists():
            clave = self.key_file.read_bytes().strip()
        else:
            clave = Fernet.generate_key()
            self.key_file.write_bytes(clave)
        return Fernet(clave)

    def _db_historial(self, usuario):
        h = hashlib.md5(usuario.encode("utf-8")).hexdigest()[:10]
        return self.base / f"historial_{h}.db"

    # ------------------------------------------------------------------ #
    # Login / logout
    # ------------------------------------------------------------------ #
    def _crear_sesion(self, usuario, clave):
        """Valida contra Educalinks (login real) y construye la sesion."""
        cliente = EducalinksClient(user=usuario, password=clave, tipo="1")
        cliente.get_agenda()  # fuerza login; lanza EducalinksError si falla
        token = secrets.token_urlsafe(32)
        hist = Historial(self._db_historial(usuario))
        return Sesion(token, usuario, cliente, hist)

    def login_invitado(self, base_usuario="invitado"):
        """Sesion sin validar: modo invitado lee solo datos locals( la agenda quedara
        vazcia si intenta llamar a Educalinks pero el app mostrara el caché)."""
        token = secrets.token_urlsafe(32)
        # Credenciales de relleno que NO se intentan hasta un intento real
        cliente = EducalinksClient(user=base_usuario, password="___invitado___", tipo="1")
        hist = Historial(self._db_historial(base_usuario))
        ses = Sesion(token, base_usuario, cliente, hist)
        with self._lock:
            self._sesiones[ses.token] = ses
        return ses

    def login(self, usuario, clave, recordar=False):
        usuario = (usuario or "").strip()
        if not usuario or not clave:
            raise EducalinksError("Ingresa usuario y contrasena")
        ses = self._crear_sesion(usuario, clave)
        with self._lock:
            self._sesiones[ses.token] = ses
            if recordar:
                cifrado = self._fernet.encrypt(clave.encode("utf-8")).decode()
                self._conn.execute(
                    "INSERT OR REPLACE INTO recordados (token, usuario, cifrado) "
                    "VALUES (?,?,?)", (ses.token, usuario, cifrado))
            else:
                self._conn.execute(
                    "DELETE FROM recordados WHERE usuario=?", (usuario,))
            self._conn.commit()
        return ses

    def por_token(self, token):
        """Recupera la sesion; revivir tokens recordados tras reiniciar."""
        if not token:
            return None
        with self._lock:
            ses = self._sesiones.get(token)
        if ses:
            return ses
        with self._lock:
            fila = self._conn.execute(
                "SELECT usuario, cifrado FROM recordados WHERE token=?",
                (token,)).fetchone()
        if not fila:
            return None
        usuario, cifrado = fila
        try:
            clave = self._fernet.decrypt(cifrado.encode()).decode()
        except InvalidToken:
            return None
        try:
            ses = self._crear_sesion(usuario, clave)
        except EducalinksError:
            return None
        with self._lock:
            self._sesiones[ses.token] = ses
        return ses

    def logout(self, token, olvidar=True):
        with self._lock:
            self._sesiones.pop(token, None)
            if olvidar:
                self._conn.execute(
                    "DELETE FROM recordados WHERE token=?", (token,))
                self._conn.commit()


auth = Auth()


def requiere_sesion(agenda_token: str | None = Cookie(default=None)) -> Sesion:
    ses = auth.por_token(agenda_token)
    if ses is None:
        raise HTTPException(status_code=401, detail="No autenticado")
    return ses
