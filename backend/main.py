"""API FastAPI que expone la agenda y el horario de Educalinks como JSON.

Ejecutar:
    uvicorn main:app --host 0.0.0.0 --port 8000
Luego abrir http://localhost:8000 (o desde el celular, http://<IP-del-PC>:8000).

El acceso requiere iniciar sesion con las credenciales de Educalinks
(validadas contra el portal real); ver auth.py.
"""

import os
import re
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from auth import Sesion, auth, requiere_sesion
from scraper import (EducalinksError, calcular_resumen, filtrar_por_semana,
                     generar_ics)
from snapshots import snapshots

app = FastAPI(title="API EducaFix", version="7.0.0")

# Despliegue publico: origenes permitidos via variable de entorno.
# Formato: URLs exactas separadas por coma, con o sin https:// y sin "/" final.
#   Ejemplos:
#     CORS_ORIGINS=*                                        (local/todo-en-uno)
#     CORS_ORIGINS=https://educafix.netlify.app             (frontend en Netlify)
#     CORS_ORIGINS=https://*.netlify.app,http://localhost:8000
# Las entradas con comodin (*.netlify.app) se convierten a regex.
_ORIGENES_RAW = [o.strip().rstrip("/") for o in
                 os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
_PERMITIR_TODO = sorted(_ORIGENES_RAW) == ["*"]
_PUBLICA = bool(os.getenv("PUBLICA"))

# Modo hibrido (frontend en Netlify + API en otro dominio): las cookies de
# sesion viajan cross-site, lo que exige SameSite=None + Secure y CORS con
# credenciales (que requiere origen explicito: el comodin total no sirve).
if _PERMITIR_TODO and not _PUBLICA:
    # local / todo-en-uno: sin CORS y sin cookies cross-site
    _ORIGENES_EXACTOS = ["*"]
    _ORIGEN_REGEX = None
    _CROSS_SITE = False
elif _PERMITIR_TODO and _PUBLICA:
    # publica sin origenes explicitos: aceptar cualquier origen con eco
    # (la API igual exige credenciales Educalinks propias de cada usuario)
    _ORIGENES_EXACTOS = []
    _ORIGEN_REGEX = r".*"
    _CROSS_SITE = True
else:
    _ORIGENES_EXACTOS = [o for o in _ORIGENES_RAW if "*" not in o]
    _ORIGENES_COMODIN = [o for o in _ORIGENES_RAW if "*" in o]
    if _ORIGENES_COMODIN:
        _ORIGEN_REGEX = "^(" + "|".join(
            re.escape(o).replace(r"\*", "[A-Za-z0-9._-]+")
            for o in _ORIGENES_COMODIN) + ")$"
    else:
        _ORIGEN_REGEX = None
    _CROSS_SITE = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGENES_EXACTOS,
    allow_origin_regex=_ORIGEN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=_CROSS_SITE,
)


# ------------------------- Endurecimiento web publica ----------------------- #
@app.middleware("http")
async def cabeceras_seguridad(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault(
        "Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    return resp


# Limitador simple en memoria contra fuerza bruta en el login (por IP)
_INTENTOS = defaultdict(list)          # ip -> [timestamps]
_LIMITE = int(os.getenv("LOGIN_RATE_LIMIT", "8"))
_VENTANA = 600                         # 10 minutos


def _ip_cliente(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "?")


def _rate_limit_login(request: Request):
    ip = _ip_cliente(request)
    ahora = time.time()
    _INTENTOS[ip] = [t for t in _INTENTOS[ip] if ahora - t < _VENTANA]
    if len(_INTENTOS[ip]) >= _LIMITE:
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
        )
    _INTENTOS[ip].append(ahora)


def _manejar_error(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


def _datos_completos(ses: Sesion):
    """Trae todo (usando cache del usuario) y detecta novedades."""
    agenda = _manejar_error(ses.cliente.get_agenda)
    horario = _manejar_error(ses.cliente.get_horario)
    mensajes = _manejar_error(ses.cliente.get_mensajes)
    circulares = _manejar_error(ses.cliente.get_circulares)
    nuevas = ses.historial.detectar(agenda, mensajes, circulares, horario)
    return agenda, horario, mensajes, circulares, nuevas


# ---------------------------------------------------------------------- #
# Autenticacion (proxy del login de Educalinks)
# ---------------------------------------------------------------------- #
class DatosLogin(BaseModel):
    usuario: str
    clave: str
    recordar: bool = False
    perfil: str = "alumno"   # 'alumno' | 'docente'


@app.post("/api/login")
def login(datos: DatosLogin, request: Request, response: Response):
    """Valida las credenciales contra Educalinks y crea la sesion."""
    _rate_limit_login(request)
    try:
        ses = auth.login(datos.usuario, datos.clave, datos.recordar,
                         datos.perfil)
    except EducalinksError as exc:
        msg = str(exc)
        if "Perfil no valido" in msg:
            raise HTTPException(status_code=400, detail=msg)
        if "Login rechazado" in msg:
            raise HTTPException(status_code=401,
                                detail="Usuario o contrasena incorrectos")
        if "Ingresa" in msg:
            raise HTTPException(status_code=400, detail=msg)
        raise HTTPException(status_code=502, detail=msg)
    cookie = {
        "key": "agenda_token",
        "value": ses.token,
        "httponly": True,
        "samesite": "none" if _CROSS_SITE else "lax",
        "path": "/",
    }
    if datos.recordar:
        cookie["max_age"] = 365 * 24 * 3600
    # Tras un proxy HTTPS la cookie viaja marcada como segura
    # (obligatorio ademas para SameSite=None en modo hibrido)
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        cookie["secure"] = True
    elif _CROSS_SITE:
        # SameSite=None requiere Secure; forzamos tras asumir HTTPS en produccion
        cookie["secure"] = True
    response.set_cookie(**cookie)
    return {"ok": True, "usuario": ses.usuario}


@app.post("/api/logout")
def logout(response: Response,
           agenda_token: str | None = Cookie(default=None)):
    if agenda_token:
        auth.logout(agenda_token, olvidar=True)
    response.delete_cookie("agenda_token", path="/")
    return {"ok": True}


@app.post("/api/invitado")
def login_invitado(response: Response):
    """Modo invitado: usa una sesion sin validar, pensada para Educalinks caido."""
    ses = auth.login_invitado()
    response.set_cookie(
        key="agenda_token",
        value=ses.token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=365 * 24 * 3600,
    )
    return {"ok": True, "usuario": ses.usuario}


@app.get("/api/status")
def estado_educalinks():
    """Estado de Educalinks (publico, no requiere sesion).

    Hace un ping ligero al portal (solo HEAD del login) y reporta si
    esta arriba, lento o caido. Cacheado 2 min para no estresar el portal.
    """
    ahora = time.time()
    cacheado = getattr(estado_educalinks, "_cache", None)
    if cacheado and ahora - cacheado["ts"] < 120:
        return cacheado["data"]

    from scraper import BASE_URL
    import requests as req
    inicio = time.time()
    try:
        r = req.head(f"{BASE_URL}/index.php", timeout=8,
                     allow_redirects=False)
        latencia = round((time.time() - inicio) * 1000)
        estado = "slow" if latencia > 3000 else "up"
        data = {"educalinks": estado, "latency_ms": latencia,
                "checked_at": ahora}
    except Exception:
        data = {"educalinks": "down", "latency_ms": None,
                "checked_at": ahora}
    estado_educalinks._cache = {"ts": ahora, "data": data}
    return data


def _con_respaldo(ses: Sesion, clave: str, fetcher):
    """Intenta fetcher(); si Educalinks cae, sirve el snapshot persistido.

    Devuelve (datos, es_snapshot, ts_snapshot). Los endpoints usan esto
    para añadir la cabecera X-Snapshot cuando sirven datos guardados.
    """
    try:
        data = fetcher()
        snapshots.guardar(ses.usuario, ses.perfil, clave, data)
        return data, False, None
    except EducalinksError:
        snap = snapshots.cargar(ses.usuario, ses.perfil, clave)
        if snap:
            return snap[0], True, snap[1]
        raise


@app.get("/api/snapshots/estado")
def snapshots_estado(ses: Sesion = Depends(requiere_sesion)):
    """Qué snapshots persistentes existen para este usuario y su edad."""
    claves = ["agenda", "horario", "mensajes", "circulares", "resumen",
              "panel", "planificacion", "asistencia", "observaciones",
              "notas_detalle"]
    resultado = []
    for c in claves:
        edad = snapshots.edad(ses.usuario, ses.perfil, c)
        resultado.append({
            "clave": c,
            "disponible": edad is not None,
            "edad_segundos": round(edad) if edad else None,
        })
    return {"snapshots": resultado}


@app.get("/api/me")
def me(ses: Sesion = Depends(requiere_sesion)):
    return {"usuario": ses.usuario, "perfil": ses.perfil}


def _requiere_alumno(ses: Sesion = Depends(requiere_sesion)) -> Sesion:
    """Guarda: los endpoints de alumno no sirven con sesion de docente."""
    if ses.perfil != "alumno":
        raise HTTPException(status_code=403,
                            detail="Esta seccion es solo para alumnos")
    return ses


def _requiere_docente(ses: Sesion = Depends(requiere_sesion)) -> Sesion:
    """Guarda: los endpoints de docente no sirven con sesion de alumno."""
    if ses.perfil != "docente":
        raise HTTPException(status_code=403,
                            detail="Esta seccion es solo para docentes")
    return ses


@app.get("/api/config")
def config():
    """Datos publicos de configuracion de la instancia EducaFix."""
    return {
        "prefill": os.getenv("EDUCA_USER", "") if not os.getenv("PUBLICA") else "",
        "escuela": os.getenv("ESCUELA_NOMBRE", "Colegio Americano de Guayaquil"),
        "app": "EducaFix",
        "publica": bool(os.getenv("PUBLICA")),
    }


# ---------------------------------------------------------------------- #
# Agenda y horario
# ---------------------------------------------------------------------- #
@app.get("/api/agenda")
def agenda(
    response: Response,
    ses: Sesion = Depends(_requiere_alumno),
    semana: date | None = Query(
        default=None,
        description="Cualquier fecha YYYY-MM-DD; se devuelve esa semana (lun-dom)",
    ),
    todas: bool = Query(default=False, description="Devuelve todas las actividades"),
):
    """Actividades de la agenda: tareas, examenes, lecciones, notas."""
    try:
        eventos, snap, ts = _con_respaldo(ses, "agenda", ses.cliente.get_agenda)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    if todas:
        return {"total": len(eventos), "eventos": eventos}

    referencia = semana if semana is not None else date.today()
    desde = referencia - timedelta(days=referencia.weekday())  # lunes
    hasta = desde + timedelta(days=6)                          # domingo

    filtrados = filtrar_por_semana(eventos, desde, hasta)
    return {
        "semana": {"desde": str(desde), "hasta": str(hasta)},
        "total": len(filtrados),
        "eventos": filtrados,
    }


@app.get("/api/horario")
def horario(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Horario semanal de clases (bloques por dia y periodo)."""
    try:
        bloques, snap, ts = _con_respaldo(ses, "horario", ses.cliente.get_horario)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    return {"total": len(bloques), "bloques": bloques}


# ---------------------------------------------------------------------- #
# Mensajes y circulares
# ---------------------------------------------------------------------- #
@app.get("/api/mensajes")
def mensajes(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Mensajes/comunicados recibidos en Educalinks."""
    try:
        lista, snap, ts = _con_respaldo(ses, "mensajes", ses.cliente.get_mensajes)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    return {"total": len(lista), "mensajes": lista}


@app.get("/api/circulares")
def circulares(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Circulares del colegio con link de descarga."""
    try:
        lista, snap, ts = _con_respaldo(ses, "circulares", ses.cliente.get_circulares)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    return {"total": len(lista), "circulares": lista}


# ---------------------------------------------------------------------- #
# Notas: resumen y libretas oficiales
# ---------------------------------------------------------------------- #
@app.get("/api/resumen")
def resumen(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Promedios por materia y periodo calculados desde la agenda."""
    try:
        eventos, _, _ = _con_respaldo(ses, "agenda", ses.cliente.get_agenda)
        libretas, _, _ = _con_respaldo(ses, "libretas", ses.cliente.get_libretas)
        data = calcular_resumen(eventos, libretas)
        snapshots.guardar(ses.usuario, ses.perfil, "resumen", data)
    except EducalinksError as exc:
        snap = snapshots.cargar(ses.usuario, ses.perfil, "resumen")
        if snap:
            response.headers["X-Snapshot"] = "true"
            response.headers["X-Snapshot-Ts"] = str(snap[1])
            return snap[0]
        raise HTTPException(status_code=502, detail=str(exc))
    return data


@app.get("/api/panel")
def panel(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Panel del portal (resumen.php): por vencer, atrasadas, hoy, pagos.

    Cache propio de 30 min (PANEL_TTL_MINUTES) porque la pagina es pesada.
    """
    try:
        data, snap, ts = _con_respaldo(ses, "panel", ses.cliente.get_panel)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    return data


@app.get("/api/planificacion")
def planificacion(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Docente por materia y leccionario de temas (planificacion.php)."""
    try:
        lista, snap, ts = _con_respaldo(ses, "planificacion", ses.cliente.get_planificacion)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    return {"total": len(lista), "materias": lista}


@app.get("/api/asistencia")
def asistencia(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Historial de faltas/atrasos del estudiante (del PDF del portal)."""
    try:
        data, snap, ts = _con_respaldo(ses, "asistencia", ses.cliente.get_faltas)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    return data


@app.get("/api/observaciones")
def observaciones(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Observaciones de comportamiento/disciplina del alumno."""
    try:
        data, snap, ts = _con_respaldo(ses, "observaciones", ses.cliente.get_observaciones)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    return data


@app.get("/api/notas/detalle")
def notas_detalle(response: Response, ses: Sesion = Depends(_requiere_alumno)):
    """Desglose oficial por periodo y materia, extraido de la libreta PDF."""
    try:
        data, snap, ts = _con_respaldo(ses, "notas_detalle", ses.cliente.get_notas_detalladas)
    except EducalinksError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if snap:
        response.headers["X-Snapshot"] = "true"
        response.headers["X-Snapshot-Ts"] = str(ts)
    return data


# ---------------------------------------------------------------------- #
# Portal docente (perfil 'docente'; scrapers adaptativos)
# ---------------------------------------------------------------------- #
@app.get("/api/docentes/panel")
def docentes_panel(ses: Sesion = Depends(_requiere_docente)):
    """Modulos reales del portal docente (menu de su index)."""
    return _manejar_error(ses.cliente.get_docentes_panel)


@app.get("/api/docentes/horario")
def docentes_horario(ses: Sesion = Depends(_requiere_docente)):
    """Horario del docente si su portal expone la tabla estandar."""
    return _manejar_error(ses.cliente.get_docentes_horario)


@app.get("/api/docentes/agenda")
def docentes_agenda(ses: Sesion = Depends(_requiere_docente)):
    """Agenda/tareas del docente (tabla generica; refinable con acceso)."""
    return _manejar_error(ses.cliente.get_docentes_agenda)


@app.get("/api/docentes/mensajes")
def docentes_mensajes(ses: Sesion = Depends(_requiere_docente)):
    return _manejar_error(ses.cliente.get_docentes_mensajes)


@app.get("/api/docentes/circulares")
def docentes_circulares(ses: Sesion = Depends(_requiere_docente)):
    return _manejar_error(ses.cliente.get_docentes_circulares)


@app.get("/api/materiales")
def materiales(ses: Sesion = Depends(_requiere_alumno)):
    """Materiales del aula virtual por clase (cache 60 min; solo lectura)."""
    lista = _manejar_error(ses.cliente.get_materiales)
    return {"total": len(lista), "materiales": lista}


@app.get("/api/notas/libretas")
def libretas(ses: Sesion = Depends(_requiere_alumno)):
    """Periodos evaluativos disponibles con su libreta oficial."""
    lista = _manejar_error(ses.cliente.get_libretas)
    return {"total": len(lista), "libretas": lista}


@app.get("/api/notas/libreta/{peri}")
def libreta_pdf(peri: int, ses: Sesion = Depends(_requiere_alumno)):
    """Descarga la libreta oficial en PDF (proxied con la sesion)."""
    lista = _manejar_error(ses.cliente.get_libretas)
    encontrada = next(
        (l for l in lista if l["peri_dist_codi"] == str(peri)), None)
    if not encontrada:
        raise HTTPException(status_code=404, detail="Libreta no encontrada")
    resp = _manejar_error(ses.cliente.descargar_pdf, encontrada["url"])
    return StreamingResponse(
        resp.iter_content(chunk_size=8192),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="libreta_{peri}.pdf"'},
    )


# ---------------------------------------------------------------------- #
# Descarga proxy de archivos de Educalinks (circulares, etc.)
# ---------------------------------------------------------------------- #
_MIMES = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
}


@app.get("/api/descargar")
def descargar(url: str = Query(...),
              nombre: str | None = Query(default=None, max_length=200),
              ses: Sesion = Depends(_requiere_alumno)):
    """Descarga un archivo de Educalinks con la sesion del usuario.

    El storage de Educalinks entrega nombres ofuscados (por eso antes los
    archivos se guardaban como .file): el frontend conoce el nombre real
    y lo pasa en ?nombre= para restaurar extension y MIME.
    """
    if not ses.cliente.url_permitida(url):
        raise HTTPException(status_code=400, detail="URL no permitida")
    resp = _manejar_error(ses.cliente.descargar_pdf, url)

    if nombre:
        # sanitizar: solo el nombre final, sin rutas ni caracteres raros
        nombre = re.sub(r'[\\/:*?"<>|]', "_",
                       nombre.strip().split("/")[-1].split("\\")[-1])
    if not nombre:
        nombre = url.split("?")[0].rstrip("/").split("/")[-1] or "archivo"

    ext = Path(nombre.lower()).suffix
    media = _MIMES.get(ext) or resp.headers.get(
        "Content-Type", "application/octet-stream")
    if "html" in media.lower():
        media = "application/octet-stream"

    return StreamingResponse(
        resp.iter_content(chunk_size=8192),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


# ---------------------------------------------------------------------- #
# Calendario exportable (.ics)
# ---------------------------------------------------------------------- #
@app.get("/api/calendario.ics")
def calendario_ics(ses: Sesion = Depends(_requiere_alumno)):
    """iCalendar con todas las actividades; utilizable como suscripcion
    de calendario (Google Calendar / Apple) gracias a METHOD:PUBLISH."""
    eventos = _manejar_error(ses.cliente.get_agenda)
    ics = generar_ics(eventos)
    return Response(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="agenda_educalinks.ics"'},
    )


# ---------------------------------------------------------------------- #
# Novedades (historial del usuario)
# ---------------------------------------------------------------------- #
class MarcarLeidas(BaseModel):
    ids: list[int] | None = None  # None = marcar todas


@app.get("/api/novedades")
def novedades(no_leidas: bool = Query(default=False),
              ses: Sesion = Depends(_requiere_alumno)):
    """Novedades detectadas; refresca los datos antes de comparar."""
    _datos_completos(ses)
    return ses.historial.listar_novedades(solo_no_leidas=no_leidas)


@app.post("/api/novedades/leer")
def marcar_leidas(payload: MarcarLeidas,
                  ses: Sesion = Depends(_requiere_alumno)):
    ses.historial.marcar_leidas(payload.ids)
    return {"ok": True}


# ---------------------------------------------------------------------- #
# Utilitarios
# ---------------------------------------------------------------------- #
@app.post("/api/refresh")
def refresh(ses: Sesion = Depends(_requiere_alumno)):
    """Limpia el cache del usuario y obliga a re-consultar Educalinks."""
    ses.cliente.clear_cache()
    agenda_data, horario_data, mensajes_data, circulares_data, _ = \
        _datos_completos(ses)
    return {
        "ok": True,
        "eventos": len(agenda_data),
        "bloques_horario": len(horario_data),
        "mensajes": len(mensajes_data),
        "circulares": len(circulares_data),
    }


# --- Frontend estatico (se monta al final para no tapar /api) ---
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
