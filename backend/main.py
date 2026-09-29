"""API FastAPI que expone la agenda y el horario de Educalinks como JSON.

Ejecutar:
    uvicorn main:app --host 0.0.0.0 --port 8000
Luego abrir http://localhost:8000 (o desde el celular, http://<IP-del-PC>:8000).

El acceso requiere iniciar sesion con las credenciales de Educalinks
(validadas contra el portal real); ver auth.py.
"""

import os
from datetime import date, timedelta
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from auth import Sesion, auth, requiere_sesion
from scraper import (EducalinksError, calcular_resumen, filtrar_por_semana,
                     generar_ics)

app = FastAPI(title="API Agenda Educalinks", version="3.0.0")

# El frontend local puede servirse desde cualquier origen en desarrollo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.post("/api/login")
def login(datos: DatosLogin, response: Response):
    """Valida las credenciales contra Educalinks y crea la sesion."""
    try:
        ses = auth.login(datos.usuario, datos.clave, datos.recordar)
    except EducalinksError as exc:
        msg = str(exc)
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
        "samesite": "lax",
        "path": "/",
    }
    if datos.recordar:
        cookie["max_age"] = 365 * 24 * 3600
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


@app.get("/api/me")
def me(ses: Sesion = Depends(requiere_sesion)):
    return {"usuario": ses.usuario}


@app.get("/api/config")
def config():
    """Datos publicos de configuracion (usuario para prellenar el login)."""
    return {"prefill": os.getenv("EDUCA_USER", "")}


# ---------------------------------------------------------------------- #
# Agenda y horario
# ---------------------------------------------------------------------- #
@app.get("/api/agenda")
def agenda(
    ses: Sesion = Depends(requiere_sesion),
    semana: date | None = Query(
        default=None,
        description="Cualquier fecha YYYY-MM-DD; se devuelve esa semana (lun-dom)",
    ),
    todas: bool = Query(default=False, description="Devuelve todas las actividades"),
):
    """Actividades de la agenda: tareas, examenes, lecciones, notas."""
    eventos = _manejar_error(ses.cliente.get_agenda)
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
def horario(ses: Sesion = Depends(requiere_sesion)):
    """Horario semanal de clases (bloques por dia y periodo)."""
    bloques = _manejar_error(ses.cliente.get_horario)
    return {"total": len(bloques), "bloques": bloques}


# ---------------------------------------------------------------------- #
# Mensajes y circulares
# ---------------------------------------------------------------------- #
@app.get("/api/mensajes")
def mensajes(ses: Sesion = Depends(requiere_sesion)):
    """Mensajes/comunicados recibidos en Educalinks."""
    lista = _manejar_error(ses.cliente.get_mensajes)
    return {"total": len(lista), "mensajes": lista}


@app.get("/api/circulares")
def circulares(ses: Sesion = Depends(requiere_sesion)):
    """Circulares del colegio con link de descarga."""
    lista = _manejar_error(ses.cliente.get_circulares)
    return {"total": len(lista), "circulares": lista}


# ---------------------------------------------------------------------- #
# Notas: resumen y libretas oficiales
# ---------------------------------------------------------------------- #
@app.get("/api/resumen")
def resumen(ses: Sesion = Depends(requiere_sesion)):
    """Promedios por materia y periodo calculados desde la agenda."""
    eventos = _manejar_error(ses.cliente.get_agenda)
    libretas = _manejar_error(ses.cliente.get_libretas)
    return calcular_resumen(eventos, libretas)


@app.get("/api/panel")
def panel(ses: Sesion = Depends(requiere_sesion)):
    """Panel del portal (resumen.php): por vencer, atrasadas, hoy, pagos.

    Cache propio de 30 min (PANEL_TTL_MINUTES) porque la pagina es pesada.
    """
    return _manejar_error(ses.cliente.get_panel)


@app.get("/api/planificacion")
def planificacion(ses: Sesion = Depends(requiere_sesion)):
    """Docente por materia y leccionario de temas (planificacion.php)."""
    lista = _manejar_error(ses.cliente.get_planificacion)
    return {"total": len(lista), "materias": lista}


@app.get("/api/asistencia")
def asistencia(ses: Sesion = Depends(requiere_sesion)):
    """Historial de faltas/atrasos del estudiante (del PDF del portal)."""
    return _manejar_error(ses.cliente.get_faltas)


@app.get("/api/notas/detalle")
def notas_detalle(ses: Sesion = Depends(requiere_sesion)):
    """Desglose oficial por periodo y materia, extraido de la libreta PDF."""
    return _manejar_error(ses.cliente.get_notas_detalladas)


@app.get("/api/materiales")
def materiales(ses: Sesion = Depends(requiere_sesion)):
    """Materiales del aula virtual por clase (cache 60 min; solo lectura)."""
    lista = _manejar_error(ses.cliente.get_materiales)
    return {"total": len(lista), "materiales": lista}


@app.get("/api/notas/libretas")
def libretas(ses: Sesion = Depends(requiere_sesion)):
    """Periodos evaluativos disponibles con su libreta oficial."""
    lista = _manejar_error(ses.cliente.get_libretas)
    return {"total": len(lista), "libretas": lista}


@app.get("/api/notas/libreta/{peri}")
def libreta_pdf(peri: int, ses: Sesion = Depends(requiere_sesion)):
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
@app.get("/api/descargar")
def descargar(url: str = Query(...), ses: Sesion = Depends(requiere_sesion)):
    """Descarga un archivo de Educalinks con la sesion del usuario."""
    if not ses.cliente.url_permitida(url):
        raise HTTPException(status_code=400, detail="URL no permitida")
    resp = _manejar_error(ses.cliente.descargar_pdf, url)
    nombre = url.split("?")[0].rstrip("/").split("/")[-1] or "archivo"
    media = resp.headers.get("Content-Type", "application/octet-stream")
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
def calendario_ics(ses: Sesion = Depends(requiere_sesion)):
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
              ses: Sesion = Depends(requiere_sesion)):
    """Novedades detectadas; refresca los datos antes de comparar."""
    _datos_completos(ses)
    return ses.historial.listar_novedades(solo_no_leidas=no_leidas)


@app.post("/api/novedades/leer")
def marcar_leidas(payload: MarcarLeidas,
                  ses: Sesion = Depends(requiere_sesion)):
    ses.historial.marcar_leidas(payload.ids)
    return {"ok": True}


# ---------------------------------------------------------------------- #
# Utilitarios
# ---------------------------------------------------------------------- #
@app.post("/api/refresh")
def refresh(ses: Sesion = Depends(requiere_sesion)):
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
