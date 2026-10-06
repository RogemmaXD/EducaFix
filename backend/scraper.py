"""Cliente/scraper para Educalinks (Colegio Americano de Guayaquil).

Educalinks no expone una API publica: este modulo inicia sesion con las
credenciales del estudiante y parsea las paginas internas para obtener
la agenda de tareas y el horario de clases en formato estructurado.
"""

import os
import re
import time
import zlib
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

# Instancia de Educalinks del colegio (configurable para despliegue publico)
BASE_URL = os.getenv("EDUCA_BASE_URL", "https://americano.educalinks.com.ec").rstrip("/")


class EducalinksError(Exception):
    pass


class EducalinksClient:
    def __init__(self, user=None, password=None, tipo=None):
        self.user = user or os.getenv("EDUCA_USER", "")
        self.password = password or os.getenv("EDUCA_PASS", "")
        self.tipo = tipo or os.getenv("EDUCA_TIPO", "1")  # 1=Alumnos, 3=Docentes
        self.cache_ttl = int(os.getenv("CACHE_TTL_MINUTES", "15")) * 60
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        })
        self._logged_in = False
        self.perfil_portal = None   # 'alumno' o 'docente' tras login
        self._cache = {}  # clave -> (timestamp, data)

    # ------------------------------------------------------------------ #
    # Autenticacion (alumnos=1 / docentes=3, mismo portal)
    # ------------------------------------------------------------------ #
    def login(self):
        if not self.user or not self.password:
            raise EducalinksError("Credenciales no configuradas en .env")

        try:
            # La cookie de sesion PHP se obtiene visitando la pagina inicial
            self.session.get(f"{BASE_URL}/index.php", timeout=30)
            resp = self.session.post(
                f"{BASE_URL}/framework/main_valid.php",
                data={
                    "usua": self.user,
                    "pass": self.password,
                    "que2": "IN_API",
                    "tipo": self.tipo,
                },
                allow_redirects=False,
                timeout=30,
            )
        except requests.RequestException:
            raise EducalinksError(
                "El portal de Educalinks no responde (mantenimiento o sin Internet)"
            )
        location = resp.headers.get("Location", "")
        if resp.status_code != 302:
            self._logged_in = False
            raise EducalinksError(
                "Login rechazado por Educalinks (verifica usuario/clave/perfil)"
            )
        if "alumnos" in location:
            self.perfil_portal = "alumno"
        elif "docentes" in location:
            self.perfil_portal = "docente"
        else:
            self._logged_in = False
            raise EducalinksError(
                "Login rechazado por Educalinks (verifica usuario/clave/perfil)"
            )
        self._logged_in = True

    def _get(self, path, _retry=True):
        """GET autenticado; reintenta una vez re-logueando si perdio la sesion."""
        try:
            if not self._logged_in:
                self.login()
            resp = self.session.get(f"{BASE_URL}{path}", timeout=30)
        except requests.RequestException:
            raise EducalinksError(
                "El portal de Educalinks no responde (mantenimiento o sin Internet)"
            )
        resp.encoding = "utf-8"
        if resp.status_code != 200:
            if resp.status_code in (502, 503, 504):
                raise EducalinksError(
                    "El portal de Educalinks falló (mantenimiento probable)"
                )
            raise EducalinksError(f"Error {resp.status_code} al obtener {path}")
        if _retry and "form_main" in resp.text and "alumnos" not in path:
            self._logged_in = False
            return self._get(path, _retry=False)
        return resp.text

    # ------------------------------------------------------------------ #
    # Cache
    # ------------------------------------------------------------------ #
    def _cached(self, key, fetcher):
        ts, data = self._cache.get(key, (0, None))
        if data is not None and (time.time() - ts) < self.cache_ttl:
            return data
        data = fetcher()
        self._cache[key] = (time.time(), data)
        return data

    def clear_cache(self):
        self._cache.clear()

    # ------------------------------------------------------------------ #
    # Agenda de tareas
    # ------------------------------------------------------------------ #
    def get_agenda(self):
        """Lista de actividades (tareas, examenes, lecciones) con sus datos."""
        return self._cached("agenda", self._fetch_agenda)

    def _fetch_agenda(self):
        # agenda_listado.php contiene la tabla completa de actividades con
        # asignatura, nombre, calificacion, fechas y estado.
        html = self._get("/alumnos/agenda_listado.php")
        soup = BeautifulSoup(html, "lxml")

        tabla = soup.find("table", id="table_agen_list")
        if not tabla:
            raise EducalinksError("No se encontro la tabla de agenda")

        eventos = []
        for fila in tabla.select("tbody tr"):
            onclick = fila.get("onclick", "")
            m_id = re.search(r"agen_view_alum\([^,]+,\s*'([^']+)'", onclick)
            celdas = fila.find_all("td")
            if len(celdas) < 10:
                continue

            icono = celdas[1].find("a")
            estado_icon = icono.get("title", "") if icono else ""
            nombre_div = celdas[5].find("div")
            calificacion = celdas[6].get_text(strip=True)

            eventos.append({
                "id": m_id.group(1) if m_id else "",
                "materia": celdas[3].get_text(strip=True),
                "periodo_codi": celdas[4].get_text(strip=True),
                "titulo": nombre_div.get_text(strip=True) if nombre_div
                          else celdas[5].get_text(strip=True),
                "calificacion": calificacion if calificacion != "-" else None,
                "fecha_inicio": self._parse_fecha(celdas[7].get_text(strip=True)),
                "fecha_fin": self._parse_fecha(celdas[8].get_text(strip=True)),
                "estado": estado_icon or celdas[9].get_text(strip=True),
            })
        return eventos

    @staticmethod
    def _parse_fecha(texto):
        """Convierte 'DD-MM-YYYY' a 'YYYY-MM-DD'; devuelve None si no aplica."""
        m = re.search(r"(\d{2})-(\d{2})-(\d{4})", texto)
        if not m:
            return None
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"

    # ------------------------------------------------------------------ #
    # Horario de clases
    # ------------------------------------------------------------------ #
    def get_horario(self):
        """Horario semanal: lista de bloques {dia, periodo, materia, inicio, fin}."""
        return self._cached("horario", self._fetch_horario)

    def _fetch_horario(self):
        html = self._get("/alumnos/horario.php")
        return self._parse_horario_html(html)

    @staticmethod
    def _parse_horario_html(html):
        soup = BeautifulSoup(html, "lxml")

        tabla = None
        for t in soup.find_all("table"):
            encabezados = [th.get_text(strip=True).upper() for th in t.find_all("th")]
            if any("LUNES" in h for h in encabezados):
                tabla = t
                break
        if not tabla:
            raise EducalinksError("No se encontro la tabla del horario")

        dias = []
        for th in tabla.find("thead").find_all("th"):
            texto = th.get_text(strip=True).upper()
            dias.append(texto if texto else None)
        # La primera columna es el numero de periodo
        dias = dias[1:]

        bloques = []
        for fila in tabla.find("tbody").find_all("tr"):
            celdas = fila.find_all("td")
            if not celdas:
                continue
            periodo = celdas[0].get_text(strip=True)
            for idx, celda in enumerate(celdas[1:]):
                if idx >= len(dias):
                    break
                enlace = celda.find("a")
                if not enlace:
                    continue  # bloque libre
                materia = enlace.get_text(strip=True).replace("\xa0", " ")
                hora = celda.find("p")
                hora_txt = hora.get_text(strip=True) if hora else ""
                m = re.search(
                    r"\(?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*\)?", hora_txt
                )
                bloques.append({
                    "dia": dias[idx],
                    "periodo": periodo,
                    "materia": materia,
                    "hora_inicio": m.group(1) if m else "",
                    "hora_fin": m.group(2) if m else "",
                })
        return bloques

    # ------------------------------------------------------------------ #
    # Mensajes
    # ------------------------------------------------------------------ #
    def get_mensajes(self):
        """Lista de mensajes/comunicados: asunto, remitente, fecha."""
        return self._cached("mensajes", self._fetch_mensajes)

    def _fetch_mensajes(self):
        html = self._get("/alumnos/mensajes")
        mensajes = self._parse_mensajes_html(html)
        return mensajes or []

    @staticmethod
    def _parse_fecha_slash(texto):
        """Convierte 'DD/MM/YYYY' a 'YYYY-MM-DD'; devuelve None si no aplica."""
        m = re.search(r"(\d{2})/(\d{2})/(\d{4})", texto)
        if not m:
            return None
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"

    # ------------------------------------------------------------------ #
    # Circulares
    # ------------------------------------------------------------------ #
    _MESES_ES = {
        "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
        "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12,
    }

    def get_circulares(self):
        """Circulares del colegio: titulo, descripcion, fecha y link de descarga."""
        return self._cached("circulares", self._fetch_circulares)

    def _fetch_circulares(self):
        html = self._get("/alumnos/circulares.php")
        soup = BeautifulSoup(html, "lxml")
        circulares = self._parse_circulares_html(soup)
        return circulares or []

    def _parse_fecha_texto(self, texto):
        """Convierte '17 Jul 2026' a '2026-07-17'; None si no aplica."""
        m = re.search(r"(\d{1,2})\s+(\w+)\s+(\d{4})", texto)
        if not m:
            return None
        mes = self._MESES_ES.get(m.group(2).lower()[:3])
        if not mes:
            return None
        return f"{m.group(3)}-{mes:02d}-{int(m.group(1)):02d}"

    # ------------------------------------------------------------------ #
    # Libretas oficiales (PDF) de notas.php
    # ------------------------------------------------------------------ #
    def get_libretas(self):
        """Periodos evaluativos con la URL de la libreta oficial en PDF."""
        return self._cached("libretas", self._fetch_libretas)

    def _fetch_libretas(self):
        html = self._get("/alumnos/notas.php")
        soup = BeautifulSoup(html, "lxml")
        tabla = soup.find("table", id="notas")
        if not tabla:
            return []
        libretas = []
        for fila in tabla.select("tbody tr"):
            celdas = fila.find_all("td")
            if len(celdas) < 2:
                continue
            enlace = celdas[1].find("a", href=True)
            if not enlace:
                continue
            m = re.search(r"peri_dist_codi=(\d+)", enlace["href"])
            periodo = " ".join(celdas[0].get_text(strip=True).split())
            codi = m.group(1) if m else ""
            # notas.php repite el ultimo periodo publicado; nos quedamos con una sola
            if codi and not any(l["peri_dist_codi"] == codi for l in libretas):
                libretas.append({
                    "periodo": periodo,
                    "peri_dist_codi": codi,
                    "url": enlace["href"],
                })
        return libretas

    # ------------------------------------------------------------------ #
    # Panel informativo (resumen.php): por vencer / atrasadas / hoy
    # ------------------------------------------------------------------ #
    def get_panel(self):
        """Panel del estudiante de resumen.php.

        Trae agendas por vencer (con cuenta regresiva), atrasadas, por
        iniciar, calificadas, materiales del dia y pagos pendientes.
        Pagina pesada: se cachea aparte con TTL propio (PANEL_TTL_MINUTES).
        """
        ttl_min = int(os.getenv("PANEL_TTL_MINUTES", "30"))
        ts, data = self._cache.get("panel", (0, None))
        if data is not None and (time.time() - ts) < ttl_min * 60:
            return data
        datos = self._fetch_panel()
        self._cache["panel"] = (time.time(), datos)
        return datos

    @staticmethod
    def _id_de_agen_view(celda_html):
        m = re.search(r"agen_view\('[^']+',(\d+)", celda_html)
        return m.group(1) if m else ""

    def _fetch_panel(self):
        html = self._get("/alumnos/resumen.php")
        soup = BeautifulSoup(html, "lxml")

        def clasificar(tabla):
            enc = [th.get_text(strip=True).lower() for th in tabla.find_all("th")]
            if any("vence" in h for h in enc):
                return "por_vencer"
            if any("atraso" in h for h in enc):
                return "atrasadas"
            if any("fecha fin" in h for h in enc):
                return "por_iniciar"
            if any("calificaci" in h for h in enc):
                return "calificadas"
            return None

        def texto_celda_nombre(td):
            """Titulo en <b> + descripcion en <p> con line-clamp."""
            b = td.find("b")
            titulo = b.get_text(" ", strip=True) if b else td.get_text(" ", strip=True)
            detalle = ""
            for p in td.find_all("p"):
                if "line-clamp" in (p.get("style") or ""):
                    detalle = p.get_text(" ", strip=True)
                    break
            return titulo, detalle

        panel = {
            "por_vencer": [], "atrasadas": [], "por_iniciar": [],
            "calificadas": [], "materiales_hoy": [], "pagos": [],
        }
        for tabla in soup.find_all("table"):
            tid = tabla.get("id", "")
            clase = " ".join(tabla.get("class") or [])
            if tid == "table_materiales":
                for fila in tabla.select("tbody tr"):
                    celdas = fila.find_all("td")
                    if len(celdas) < 3:
                        continue
                    titulo, detalle = texto_celda_nombre(celdas[1])
                    panel["materiales_hoy"].append({
                        "titulo": titulo,
                        "detalle": detalle,
                        "materia": celdas[2].get_text(strip=True),
                    })
                continue
            if "dataTable" not in clase:
                continue
            tipo = clasificar(tabla)
            if not tipo:
                continue
            for fila in tabla.select("tbody tr"):
                celdas = fila.find_all("td")
                # la celda "Nombre" es la que contiene el titulo en <b>
                idx_nom = next((i for i, td in enumerate(celdas)
                                if td.find("b")), None)
                if idx_nom is None or len(celdas) <= idx_nom:
                    continue
                titulo, detalle = texto_celda_nombre(celdas[idx_nom])
                item = {
                    "id": self._id_de_agen_view(str(fila)),
                    "titulo": titulo,
                    "detalle": detalle,
                    "materia": celdas[idx_nom + 1].get_text(strip=True)
                               if len(celdas) > idx_nom + 1 else "",
                }
                if tipo == "por_vencer":
                    item["fecha"] = self._fecha_yyyymmdd(
                        celdas[idx_nom + 2].get_text(strip=True)) if len(celdas) > idx_nom + 2 else None
                    item["vence"] = celdas[idx_nom + 3].get_text(strip=True) if len(celdas) > idx_nom + 3 else ""
                elif tipo == "atrasadas":
                    item["fecha"] = self._fecha_yyyymmdd(
                        celdas[idx_nom + 2].get_text(strip=True)) if len(celdas) > idx_nom + 2 else None
                    try:
                        item["dias_atraso"] = int(
                            celdas[idx_nom + 3].get_text(strip=True)) if len(celdas) > idx_nom + 3 else None
                    except ValueError:
                        item["dias_atraso"] = None
                elif tipo == "por_iniciar":
                    item["fecha"] = self._fecha_yyyymmdd(
                        celdas[idx_nom + 2].get_text(strip=True)) if len(celdas) > idx_nom + 2 else None
                    item["fecha_fin"] = self._fecha_yyyymmdd(
                        celdas[idx_nom + 3].get_text(strip=True)) if len(celdas) > idx_nom + 3 else None
                else:  # calificadas
                    item["calificacion"] = (celdas[idx_nom + 2].get_text(strip=True)
                                            if len(celdas) > idx_nom + 2 else "") or None
                panel[tipo].append(item)

        # Pagos (tabla con encabezado "No. referencia")
        for tabla in soup.find_all("table"):
            enc = [th.get_text(strip=True).lower() for th in tabla.find_all("th")]
            if any("referencia" in h for h in enc):
                for fila in tabla.select("tbody tr"):
                    celdas = fila.find_all("td")
                    if len(celdas) < 5:
                        continue
                    panel["pagos"].append({
                        "referencia": celdas[0].get_text(strip=True),
                        "deuda": celdas[1].get_text(strip=True),
                        "periodo": celdas[2].get_text(strip=True),
                        "vencimiento": self._fecha_yyyymmdd(celdas[3].get_text(strip=True)),
                        "valor": celdas[4].get_text(strip=True),
                    })
                break
        return panel

    @staticmethod
    def _fecha_yyyymmdd(texto):
        """'2026-09-29' ya viene ISO en resumen.php; valida y devuelve."""
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", texto or "")
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None

    # ------------------------------------------------------------------ #
    # Planificacion: docentes por materia + leccionario (temas/actividades)
    # ------------------------------------------------------------------ #
    def get_planificacion(self):
        """Docente por materia y leccionario de temas (planificacion.php).

        Cache largo (PLANIFICACION_TTL_MINUTES, 6 h por defecto) porque
        cambia muy poco y la pagina es pesada.
        """
        ttl_min = int(os.getenv("PLANIFICACION_TTL_MINUTES", "360"))
        ts, data = self._cache.get("planificacion", (0, None))
        if data is not None and (time.time() - ts) < ttl_min * 60:
            return data
        datos = self._fetch_planificacion()
        self._cache["planificacion"] = (time.time(), datos)
        return datos

    def _fetch_planificacion(self):
        html = self._get("/alumnos/planificacion.php")

        # El HTML de tabs_6 es invalido (li mal anidados) y lxml rompe la
        # estructura, asi que se extrae por bloques con regex.
        bloques = re.findall(
            r'<li>\s*<div class="md-card-content">(.*?)</li>',
            html, re.S)
        materias = []
        for bloque in bloques:
            m_nombre = re.search(
                r"import_contacts\s*</i>\s*([^<]+)</label>", bloque)
            m_doc = re.search(r"Docente:\s*([^)]+)", bloque)
            m_cod = re.search(r"getURLPlanificacion\((\d+)", bloque)
            if not m_nombre:
                continue
            materia = {
                "materia": m_nombre.group(1).strip(),
                "docente": m_doc.group(1).strip() if m_doc else "",
                "cod": m_cod.group(1) if m_cod else "",
                "leccionario": {"columnas": [], "filas": []},
            }
            # leccionario: primera tabla del bloque (si existe contenido)
            m_tabla = re.search(r"<table[^>]*>(.*?)</table>", bloque, re.S)
            if m_tabla:
                for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", m_tabla.group(1), re.S):
                    celdas = [BeautifulSoup(c, "lxml").get_text(" ", strip=True)
                              for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
                    celdas = [c for c in celdas if c]
                    if not celdas or "No se ha encontrado" in " ".join(celdas):
                        continue
                    if not materia["leccionario"]["columnas"]:
                        materia["leccionario"]["columnas"] = celdas
                    else:
                        materia["leccionario"]["filas"].append(celdas)
            materias.append(materia)
        return materias

    # ------------------------------------------------------------------ #
    # Asistencia: historial de faltas/atrasos (PDF de Educalinks)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _texto_pdf(contenido):
        """Extrae el texto de un PDF TCPDF descomprimiendo streams Flate.

        Educalinks genera sus PDFs con TCPDF, cuyo texto queda en operadores
        Tj/TJ dentro de streams zlib: no hace falta ninguna dependencia.
        """
        piezas = []
        for st in re.findall(rb"stream\r?\n(.*?)\r?\nendstream",
                             contenido, re.S):
            try:
                txt = zlib.decompress(st)
            except zlib.error:
                continue
            for p in re.findall(rb"\((?:[^()\\]|\\.)*\)", txt):
                try:
                    s = p[1:-1].decode("latin-1", "replace")
                except Exception:
                    continue
                s = (s.replace("\\(", "(").replace("\\)", ")")
                       .replace("\\\\", "\\"))
                if s.strip():
                    piezas.append(s)
        return piezas

    def get_faltas(self):
        """Historial de asistencia (faltas justificadas/injustificadas y
        atrasos) tomado del PDF del portal. Cache largo: cambia poco."""
        ttl_min = int(os.getenv("FALTAS_TTL_MINUTES", "360"))
        ts, data = self._cache.get("faltas", (0, None))
        if data is not None and (time.time() - ts) < ttl_min * 60:
            return data
        datos = self._fetch_faltas()
        self._cache["faltas"] = (time.time(), datos)
        return datos

    def _fetch_faltas(self):
        # El menu de alumnos contiene el enlace con el parametro del curso
        html = self._get("/alumnos/index.php")
        m = re.search(
            r"alum_rep_falta_deta_pdf\.php\?alum_curs_para_codi=(\d+)", html)
        if not m:
            return {"disponible": False, "eventos": [], "resumen": {}}
        url = (f"/alumnos/reportes_alumnos/alum_rep_falta_deta_pdf.php"
               f"?alum_curs_para_codi={m.group(1)}")
        if not self._logged_in:
            self.login()
        resp = self.session.get(f"{BASE_URL}{url}", timeout=60)
        if resp.status_code != 200 or not resp.content.startswith(b"%PDF"):
            return {"disponible": False, "eventos": [], "resumen": {}}

        piezas = self._texto_pdf(resp.content)
        ruido = ("UNIDAD", "AMERICANO", "AÑO LECTIVO", "HISTORIAL",
                 "TÍTULO", "Powered by TCPDF", "FECHA", "TIPO")
        limpias = [p for p in piezas
                   if not any(r in p for r in ruido) and len(p.strip()) > 2]

        eventos = []
        i = 0
        while i < len(limpias):
            mfecha = re.match(r"(\d{4})/(\d{2})/(\d{2})", limpias[i])
            if mfecha:
                titulo = limpias[i - 1] if i > 0 else ""
                tipo = limpias[i + 1] if i + 1 < len(limpias) else ""
                eventos.append({
                    "titulo": titulo,
                    "fecha": f"{mfecha.group(1)}-{mfecha.group(2)}-"
                             f"{mfecha.group(3)}",
                    "tipo": tipo,
                })
                i += 2
            else:
                i += 1

        resumen = {"faltas_justificadas": 0, "faltas_injustificadas": 0,
                   "atrasos": 0}
        for ev in eventos:
            t = ev["tipo"].upper()
            if "ATRASO" in t:
                resumen["atrasos"] += 1
            elif "JUSTIFICADAS" in t and "INJUSTIFICADAS" not in t:
                resumen["faltas_justificadas"] += 1
            else:
                resumen["faltas_injustificadas"] += 1
        eventos.sort(key=lambda e: e["fecha"], reverse=True)
        return {"disponible": True, "eventos": eventos, "resumen": resumen}

    # ------------------------------------------------------------------ #
    # Notas detalladas de la libreta (desglose oficial por materia)
    # ------------------------------------------------------------------ #
    _RE_NUM = re.compile(r"^\d{1,2}(?:[.,]\d{1,2})?$")

    def get_notas_detalladas(self):
        """Desglose oficial de la libreta por periodo y materia.

        Extraido del PDF lib_one.php (TCPDF): componentes (TAR/LEC/ACT/TRG),
        aporte del cierre (70%), examen parcial (30%) y total del periodo.
        Cache muy largo (12 h): solo cambia al publicarse nuevas notas.
        """
        ttl_min = int(os.getenv("LIBRETA_TTL_MINUTES", "720"))
        ts, data = self._cache.get("notas_det", (0, None))
        if data is not None and (time.time() - ts) < ttl_min * 60:
            return data
        datos = self._fetch_notas_detalladas()
        self._cache["notas_det"] = (time.time(), datos)
        return datos

    def _fetch_notas_detalladas(self):
        periodos = []
        for lib in self.get_libretas():
            try:
                resp = self.descargar_pdf(lib["url"])
            except EducalinksError:
                continue
            if not resp.content.startswith(b"%PDF"):
                continue
            piezas = self._texto_pdf(resp.content)
            ini = None
            for i, p in enumerate(piezas):
                if "ASIGNATURAS" in p.upper():
                    ini = i
                    break
            if ini is None:
                continue
            materias = []
            i = ini + 1
            while i < len(piezas):
                p = piezas[i].strip()
                if self._RE_NUM.match(p):
                    i += 1
                    continue
                nums = []
                j = i + 1
                while (j < len(piezas) and len(nums) < 8
                       and self._RE_NUM.match(piezas[j].strip())):
                    nums.append(float(piezas[j].replace(",", ".")))
                    j += 1
                if len(nums) >= 5 and len(p) > 2 and not p[0].isdigit():
                    materias.append({
                        "materia": p,
                        "componentes": nums[:4],
                        "aporte_cierre_70": nums[4] if len(nums) > 4 else None,
                        "examen_parcial": nums[5] if len(nums) > 5 else None,
                        "aporte_parcial_30": nums[6] if len(nums) > 6 else None,
                        "total": nums[7] if len(nums) > 7
                                  else (nums[-1] if nums else None),
                    })
                    i = j
                else:
                    i += 1
            if materias:
                periodos.append({
                    "periodo": lib["periodo"],
                    "peri_dist_codi": lib["peri_dist_codi"],
                    "materias": materias,
                })
        return {"disponible": bool(periodos), "periodos": periodos}

    # ------------------------------------------------------------------ #
    # Portal docente (adaptativo: el menu del profe define los modulos)
    # ------------------------------------------------------------------ #
    def _doc_menu(self):
        """Menu del portal docente leido de su index: [{nombre, ruta}]."""
        ts, data = self._cache.get("doc_menu", (0, None))
        if data is not None and (time.time() - ts) < self.cache_ttl:
            return data
        html = self._get("/docentes/index.php")
        soup = BeautifulSoup(html, "lxml")
        modulos, vistos = [], set()
        for a in soup.select("a[href*='.php']"):
            href = a.get("href", "").strip()
            nombre = a.get_text(" ", strip=True)
            if (not href or href.startswith("#") or "salir" in href
                    or "admin_pass" in href or not nombre):
                continue
            if href in vistos:
                continue
            vistos.add(href)
            modulos.append({"nombre": nombre, "ruta": href})
        self._cache["doc_menu"] = (time.time(), modulos)
        return modulos

    @staticmethod
    def _doc_abs(ruta):
        """Convierte una ruta del menu docente en ruta absoluta del portal."""
        ruta = (ruta or "").strip()
        if ruta.startswith("http"):
            return ruta
        if ruta.startswith("../"):
            return "/" + ruta[3:]
        if ruta.startswith("./"):
            ruta = ruta[2:]
        if ruta.startswith("/"):
            return ruta
        return "/docentes/" + ruta

    def _doc_ruta(self, patron):
        """Devuelve la ruta del menu docente cuyo nombre coincida."""
        try:
            for m in self._doc_menu():
                if re.search(patron, m["nombre"], re.I):
                    return m["ruta"]
        except EducalinksError:
            pass
        return None

    def get_docentes_panel(self):
        """Panel docente: modulos reales de su portal (descubrimiento)."""
        return self._cached("doc_panel", self._fetch_docentes_panel)

    def _fetch_docentes_panel(self):
        try:
            return {"disponible": True, "modulos": self._doc_menu()}
        except EducalinksError as exc:
            return {"disponible": False, "razon": str(exc), "modulos": []}

    def get_docentes_horario(self):
        """Horario del docente: parser de la tabla LUNES-DOMINGO sobre la
        ruta 'Horarios' de su propio menu (fallback: horario.php)."""
        return self._cached("doc_horario", self._fetch_docentes_horario)

    def _fetch_docentes_horario(self):
        candidatas = []
        r = self._doc_ruta(r"horario")
        if r:
            candidatas.append(r)
        candidatas.append("/docentes/horario.php")
        for ruta in candidatas:
            try:
                html = self._get(self._doc_abs(ruta))
                bloques = self._parse_horario_html(html)
                if bloques:
                    return {"disponible": True, "ruta": ruta, "bloques": bloques}
            except (EducalinksError, Exception):
                continue
        return {"disponible": False,
                "razon": "No se encontró la tabla de horario en el portal docente",
                "bloques": []}

    def get_docentes_mensajes(self):
        return self._cached("doc_mensajes", self._fetch_docentes_mensajes)

    def _fetch_docentes_mensajes(self):
        candidatas = []
        r = self._doc_ruta(r"mensaje|comunicad")
        if r:
            candidatas.append(r)
        candidatas.append("/docentes/mensajes.php")
        for ruta in candidatas:
            try:
                html = self._get(self._doc_abs(ruta))
                mensajes = self._parse_mensajes_html(html)
                if mensajes is not None:
                    return {"disponible": True, "ruta": ruta, "mensajes": mensajes}
            except (EducalinksError, Exception):
                continue
        return {"disponible": False, "razon": "Mensajes no detectados",
                "mensajes": []}

    def _parse_mensajes_html(self, html):
        """Parser compartido de mensajes (alumnos y docentes comparten UI)."""
        soup = BeautifulSoup(html, "lxml")
        enlaces = soup.select('a[href*="mens_codi="]')
        if not enlaces:
            return None
        mensajes, vistos = [], set()
        for enlace in enlaces:
            m = re.search(r"mens_codi=(\d+)", enlace.get("href", ""))
            if not m or m.group(1) in vistos:
                continue
            vistos.add(m.group(1))
            item = enlace.find_parent("li")
            remitente, fecha_txt = "", ""
            if item:
                span = item.select_one("span.uk-text-muted")
                if span:
                    remitente = span.get_text(strip=True)
                small = item.find("small")
                if small:
                    fecha_txt = small.get_text(strip=True)
            mensajes.append({
                "id": m.group(1),
                "asunto": enlace.get_text(strip=True),
                "remitente": remitente,
                "fecha": self._parse_fecha_slash(fecha_txt),
            })
        return mensajes

    def get_docentes_circulares(self):
        return self._cached("doc_circulares", self._fetch_docentes_circulares)

    def _fetch_docentes_circulares(self):
        candidatas = []
        r = self._doc_ruta(r"circular")
        if r:
            candidatas.append(r)
        candidatas.append("/docentes/circulares.php")
        for ruta in candidatas:
            try:
                html = self._get(self._doc_abs(ruta))
                soup = BeautifulSoup(html, "lxml")
                circulares = self._parse_circulares_html(soup)
                if circulares is not None:
                    return {"disponible": True, "ruta": ruta, "circulares": circulares}
            except (EducalinksError, Exception):
                continue
        return {"disponible": False, "razon": "Circulares no detectadas",
                "circulares": []}

    @staticmethod
    def _parse_circulares_html(soup):
        cards = soup.select("div.md-card-horizontal")
        if not cards:
            return None
        meses = EducalinksClient._MESES_ES
        circulares = []
        for card in cards:
            enlace = card.select_one("h3 a")
            if not enlace:
                continue
            descripcion, fecha = "", None
            for li in card.select("ul.md-list li"):
                spans = li.find_all("span")
                if len(spans) < 2:
                    continue
                rotulo = spans[0].get_text(strip=True).lower()
                valor = spans[-1].get_text(strip=True)
                if "inform" in rotulo:
                    descripcion = valor
                elif "fecha" in rotulo:
                    m = re.search(r"(\d{1,2})\s+(\w+)\s+(\d{4})", valor)
                    if m:
                        mes = meses.get(m.group(2).lower()[:3])
                        if mes:
                            fecha = f"{m.group(3)}-{mes:02d}-{int(m.group(1)):02d}"
            circulares.append({
                "titulo": enlace.get_text(strip=True),
                "descripcion": descripcion,
                "fecha": fecha,
                "url": enlace.get("href", ""),
            })
        return circulares

    def get_docentes_agenda(self):
        """Agenda del docente: tabla generica del modulo 'Tareas/Agenda'.

        Sin credenciales de prueba no se conoce el DOM exacto: se extrae
        la primera tabla sustancial (columnas + filas crudas) para que la
        UI muestre lo que exista y refinemos cuando haya acceso real.
        """
        return self._cached("doc_agenda", self._fetch_docentes_agenda)

    def _fetch_docentes_agenda(self):
        candidatas = []
        for patron in (r"tarea", r"agenda"):
            r = self._doc_ruta(patron)
            if r and r not in candidatas:
                candidatas.append(r)
        candidatas.append("/docentes/agenda.php")
        for ruta in candidatas:
            try:
                html = self._get(self._doc_abs(ruta))
                tabla = self._primera_tabla_sustancial(html)
                if tabla:
                    return {"disponible": True, "ruta": ruta, **tabla}
            except (EducalinksError, Exception):
                continue
        return {"disponible": False,
                "razon": "Agenda no detectada (pendiente mapeo con credenciales docentes)",
                "columnas": [], "filas": []}

    @staticmethod
    def _primera_tabla_sustancial(html):
        soup = BeautifulSoup(html, "lxml")
        for t in soup.find_all("table"):
            columnas = [th.get_text(" ", strip=True)
                       for th in t.find_all("th") if th.get_text(strip=True)]
            filas = []
            for tr in t.select("tbody tr"):
                celdas = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
                celdas = [c for c in celdas if c != ""]
                if len(celdas) >= 2:
                    filas.append(celdas)
            if filas and (columnas or len(filas) >= 3):
                return {"columnas": columnas, "filas": filas[:200]}
        return None

    # ------------------------------------------------------------------ #
    # Observaciones de comportamiento (alumnos, tabla de inspeccion)
    # ------------------------------------------------------------------ #
    def get_observaciones(self):
        """Observaciones/disciplina del alumno (tabla de inspeccion)."""
        return self._cached("observaciones", self._fetch_observaciones)

    def _fetch_observaciones(self):
        html = self._get("/alumnos/notas.php")
        soup = BeautifulSoup(html, "lxml")
        tabla = soup.find("table", id="tbl_alum_insp")
        if not tabla:
            return {"disponible": False, "observaciones": []}
        obs = []
        for tr in tabla.select("tbody tr"):
            celdas = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            celdas = [c for c in celdas if c != ""]
            if len(celdas) >= 4:
                obs.append({
                    "periodo": celdas[0],
                    "fecha": celdas[1],
                    "tipo": celdas[2],
                    "detalle": celdas[3],
                    "puntos": celdas[4] if len(celdas) > 4 else "",
                })
        return {"disponible": True, "observaciones": obs}

    # ------------------------------------------------------------------ #
    # Codigo interno del estudiante (para enviar mensajes)
    # ------------------------------------------------------------------ #
    def get_alum_codi(self):
        """Extrae el codigo interno del estudiante (alum_codi).

        El valor vive en un <input type="hidden" id="mens_de"> en
        resumen.php (el formulario de mensajes lo usa como remitente).
        """
        cacheado = self._cache.get("alum_codi")
        if cacheado and (time.time() - cacheado[0]) < self.cache_ttl:
            return cacheado[1]
        codi = ""
        try:
            html = self._get("/alumnos/resumen.php")
            m = re.search(r'id="mens_de"[^>]*value=[\'"]?(\d+)', html)
            if m:
                codi = m.group(1)
        except EducalinksError:
            pass
        self._cache["alum_codi"] = (time.time(), codi)
        return codi

    # ------------------------------------------------------------------ #
    # Cuerpo completo de mensajes (desde resumen.php table_mensajes)
    # ------------------------------------------------------------------ #
    def get_mensajes_completos(self):
        """Cuerpo completo de mensajes recibidos (tabla de notificaciones
        de resumen.php, pestaña 'Notificaciones')."""
        return self._cached("mensajes_full", self._fetch_mensajes_completos)

    def _fetch_mensajes_completos(self):
        html = self._get("/alumnos/resumen.php")
        soup = BeautifulSoup(html, "lxml")
        tabla = soup.find("table", id="table_mensajes")
        if not tabla:
            return {"disponible": False, "mensajes": []}
        mensajes = []
        for fila in tabla.select("tbody tr"):
            celdas = fila.find_all("td")
            if len(celdas) < 3:
                continue
            docente = celdas[0].get_text(" ", strip=True)
            cuerpo = celdas[1].get_text(" ", strip=True)
            recibido = celdas[2].get_text(" ", strip=True)
            leido = len(celdas) > 3 and celdas[3].get_text(strip=True).strip() != ""
            mensajes.append({
                "docente": docente,
                "cuerpo": cuerpo[:3000],
                "recibido": recibido,
                "leido": leido,
            })
        return {"disponible": True, "mensajes": mensajes}

    # ------------------------------------------------------------------ #
    # Eventos del calendario (desde index.php)
    # ------------------------------------------------------------------ #
    def get_eventos(self):
        """Eventos del colegio (calendario de index.php)."""
        return self._cached("eventos", self._fetch_eventos)

    def _fetch_eventos(self):
        html = self._get("/alumnos/index.php")
        # Buscar: var eventos = [{"icono":"...","date":"2026-05-20","title":"...",...}, ...];
        eventos = []
        for m in re.finditer(r'"date"\s*:\s*"([\d-]+)".*?"title"\s*:\s*"([^"]*)"', html):
            fecha = m.group(1)
            titulo = m.group(2).replace("\\u00a1", "¡").replace("\\u00bf", "¿")
            eventos.append({"fecha": fecha, "titulo": titulo, "url": ""})
        # también buscar adjuntos (PDFs de eventos)
        for ev in eventos:
            m2 = re.search(r'"title"\s*:\s*"' + re.escape(ev["titulo"]) +
                           r'".*?"img"\s*:\s*"([^"]*)"', html)
            if m2:
                ev["pdf"] = m2.group(1).replace("\\/", "/")
        return {"disponible": bool(eventos), "eventos": eventos}

    # ------------------------------------------------------------------ #
    # Enlaces a plataformas externas (enlace.php)
    # ------------------------------------------------------------------ #
    def get_enlaces_externos(self):
        """Plataformas externas a las que el colegio da acceso."""
        return self._cached("enlaces", self._fetch_enlaces_externos)

    def _fetch_enlaces_externos(self):
        try:
            html = self._get("/alumnos/enlace.php")
        except EducalinksError:
            return {"disponible": False, "enlaces": []}
        soup = BeautifulSoup(html, "lxml")
        enlaces = []
        # excluir navegacion interna y enlaces de sistema
        excluir = ("educalinks", "salir", "contrase", "admin_pass",
                   "index.php", "#", "javascript", "recupera",
                   "fonts.google", "gstatic", "css", "js", "img",
                   "dist/", "bower")
        for a in soup.select("a[href]"):
            href = a.get("href", "").strip()
            texto = a.get_text(" ", strip=True)
            if (not href or not texto or len(texto) < 4):
                continue
            href_l = href.lower()
            if any(x in href_l for x in excluir):
                continue
            if href_l.endswith((".css", ".js", ".png", ".ico", ".jpg")):
                continue
            enlaces.append({
                "nombre": texto,
                "url": href if href.startswith("http") else BASE_URL + "/" + href,
            })
        return {"disponible": bool(enlaces), "enlaces": enlaces}

    # ------------------------------------------------------------------ #
    # ENVIAR MENSAJES (escritura en Educalinks)
    # ------------------------------------------------------------------ #
    def enviar_mensaje(self, para_codi, para_tipo, asunto, cuerpo):
        """Envía un mensaje a través del portal de Educalinks.

        POST a mensajes_nuevo_script_envio.php con DO=ADD.
        para_codi: matrícula del destinatario
        para_tipo: 'D' (docente) o 'A' (alumno)
        """
        if not self._logged_in:
            self.login()
        alum_codi = self.get_alum_codi()
        if not alum_codi:
            raise EducalinksError("No se pudo obtener tu código de estudiante")

        dest = json.dumps([{
            "mens_para": para_codi,
            "mens_para_tipo": para_tipo,
            "mens_alum_codi": alum_codi,
        }])
        data = {
            "mens_de": alum_codi,
            "mens_de_tipo": "A",
            "mens_dest": dest,
            "mens_titu": asunto,
            "mens_deta": cuerpo,
            "DO": "ADD",
        }
        resp = self.session.post(
            f"{BASE_URL}/alumnos/mensajes_nuevo_script_envio.php",
            data=data, timeout=30)
        if resp.status_code != 200:
            raise EducalinksError(f"Error {resp.status_code} al enviar mensaje")
        # respuesta JSON: {tipo: "error"|"success", mensaje: "..."}
        try:
            r = resp.json()
            if r.get("tipo") == "error":
                raise EducalinksError(r.get("mensaje", "Error al enviar"))
            return {"ok": True, "mensaje": r.get("mensaje", "Mensaje enviado")}
        except ValueError:
            # si no es JSON, asumir éxito si status 200
            return {"ok": True, "mensaje": "Mensaje enviado"}

    def responder_mensaje(self, para_codi, para_tipo, asunto, cuerpo):
        """Responde a un mensaje existente (DO=RESP)."""
        if not self._logged_in:
            self.login()
        alum_codi = self.get_alum_codi()
        if not alum_codi:
            raise EducalinksError("No se pudo obtener tu código de estudiante")
        data = {
            "mens_de": alum_codi,
            "mens_de_tipo": "A",
            "mens_para": para_codi,
            "mens_para_tipo": para_tipo,
            "mens_titu": asunto,
            "mens_deta": cuerpo,
            "DO": "RESP",
        }
        resp = self.session.post(
            f"{BASE_URL}/alumnos/mensajes_nuevo_script_envio.php",
            data=data, timeout=30)
        if resp.status_code != 200:
            raise EducalinksError(f"Error {resp.status_code} al responder")
        try:
            r = resp.json()
            if r.get("tipo") == "error":
                raise EducalinksError(r.get("mensaje", "Error al responder"))
            return {"ok": True, "mensaje": r.get("mensaje", "Respuesta enviada")}
        except ValueError:
            return {"ok": True, "mensaje": "Respuesta enviada"}

    def subir_tarea(self, agen_codi, archivo_bytes, archivo_nombre, nombre_materia):
        """Sube un archivo de tarea como estudiante.

        POST a scrip_upload_file_alum.php con FormData:
        - tarea_upload: File (PDF/JPG/JPEG/PNG, max 2MB)
        - id_agen_alum_actividad_notas: ID de la actividad
        - nombreMateria: nombre de la materia
        """
        if not self._logged_in:
            self.login()
        files = {"tarea_upload": (archivo_nombre, archivo_bytes)}
        data = {
            "id_agen_alum_actividad_notas": str(agen_codi),
            "nombreMateria": nombre_materia,
        }
        resp = self.session.post(
            f"{BASE_URL}/alumnos/scrip_upload_file_alum.php",
            files=files, data=data, timeout=60)
        if resp.status_code != 200:
            raise EducalinksError(f"Error {resp.status_code} al subir tarea")
        texto = resp.text.strip()
        if texto == "OK":
            return {"ok": True, "mensaje": "Tarea enviada correctamente"}
        elif texto == "0":
            raise EducalinksError("El archivo no se pudo subir")
        elif texto == "2":
            raise EducalinksError("El nombre del archivo no debe contener puntos, comas u otros caracteres especiales")
        elif texto == "3":
            raise EducalinksError("El archivo debe ser PDF, JPG, JPEG o PNG")
        elif texto == "4":
            raise EducalinksError("El archivo supera los 2MB permitidos")
        elif texto == "5":
            raise EducalinksError("La tarea ya fue subida anteriormente")
        elif texto == "6":
            raise EducalinksError("Error al subir la tarea (código 6)")
        raise EducalinksError(f"Respuesta desconocida: {texto}")

    def subir_enlaces_tarea(self, agen_codi, enlaces):
        """Envía enlaces de tarea virtual como estudiante.

        POST a script_agen.php con opc=agen_enlaces_alum.
        """
        if not self._logged_in:
            self.login()
        data = {
            "enlaces": enlaces,
            "opc": "agen_enlaces_alum",
            "id": str(agen_codi),
        }
        resp = self.session.post(
            f"{BASE_URL}/alumnos/script_agen.php",
            data=data, timeout=30)
        if resp.status_code != 200:
            raise EducalinksError(f"Error {resp.status_code} al enviar enlaces")
        texto = resp.text.strip()
        if texto == "OK":
            return {"ok": True, "mensaje": "Enlaces enviados correctamente"}
        raise EducalinksError(f"Error al enviar enlaces: {texto}")

    # ------------------------------------------------------------------ #
    # Portal docente: scaffold de escritura (preparado para credenciales)
    # ------------------------------------------------------------------ #
    def crear_actividad_docente(self, curs_mate_prof, titulo, detalle,
                                 fecha_inicio, fecha_fin, tipo="T"):
        """Crea una actividad/tarea en el portal docente.

        REQUIERE credenciales de docente. Los campos se basan en el
        patrón de POST del portal (form-data a script .php con opc=).
        Este método está preparado pero NO PROBADO sin credenciales.
        """
        if not self._logged_in:
            self.login()
        if self.perfil_portal != "docente":
            raise EducalinksError("Se necesita perfil de docente")
        # Endpoint estimado basado en el patrón del portal
        data = {
            "opc": "set_agenda",
            "curs_mate_prof": curs_mate_prof,
            "agen_titu": titulo,
            "agen_deta": detalle,
            "agen_fech_ini": fecha_inicio,
            "agen_fech_fin": fecha_fin,
            "agen_tipo": tipo,
        }
        resp = self.session.post(
            f"{BASE_URL}/docentes/script_agenda.php",
            data=data, timeout=30)
        if resp.status_code != 200:
            raise EducalinksError(f"Error {resp.status_code} al crear actividad")
        try:
            r = resp.json()
            if r.get("tipo") == "error":
                raise EducalinksError(r.get("mensaje", "Error al crear"))
            return {"ok": True, "mensaje": r.get("mensaje", "Actividad creada")}
        except ValueError:
            return {"ok": True, "mensaje": "Actividad creada"}

    # ------------------------------------------------------------------ #
    # Aula virtual: catalogo de clases y sus materiales
    # ------------------------------------------------------------------ #
    def get_materias_clase(self):
        """Todas las clases del estudiante con los ids para abrir el aula virtual."""
        return self._cached("materias", self._fetch_materias_clase)

    def _fetch_materias_clase(self):
        html = self._get("/alumnos/materias.php")
        materias = []
        for cm, cmp_, acm, ac, cod, nom in re.findall(
            r"set_alumno_materia\((\d+),(\d+),(\d+),(\d+),(\d+),'([^']+)'\)", html
        ):
            materias.append({
                "cod_mate": cod, "nombre": nom.strip(),
                "curs_mate": cm, "curs_mate_prof": cmp_,
                "alum_curs_mate": acm, "alum_curs": ac,
            })
        return materias

    def get_materiales(self):
        """Materiales por clase del aula virtual.

        Lento la primera vez (visita cada clase); por eso se cachea aparte
        (MATERIALES_TTL_MINUTES, por defecto 60 min) para no estresar Educalinks.
        """
        ts, data = self._cache.get("materiales", (0, None))
        ttl = int(os.getenv("MATERIALES_TTL_MINUTES", "60")) * 60
        if data is not None and (time.time() - ts) < ttl:
            return data
        datos = self._fetch_materiales()
        self._cache["materiales"] = (time.time(), datos)
        return datos

    def _fetch_materiales(self):
        resultado = []
        try:
            materias = self.get_materias_clase()
        except EducalinksError:
            return []
        for m in materias:
            try:
                # El portal "selecciona" la clase en la sesion con este POST
                # (es lo mismo que hace un clic de usuario en la card; no escribe datos).
                self.session.post(
                    f"{BASE_URL}/alumnos/script_set_alum.php",
                    data={
                        "opc": "set_alum_mate",
                        "curs_mate": m["curs_mate"], "curs_mate_prof": m["curs_mate_prof"],
                        "alum_curs_mate": m["alum_curs_mate"], "alum_curs": m["alum_curs"],
                        "cod_mate": m["cod_mate"], "desc_mate": m["nombre"],
                    },
                    timeout=30,
                )
                time.sleep(0.4)
                html = self._get("/alumnos/aulavirtual/materiales/")
                resultado.append({
                    "materia": m["nombre"],
                    "cod_mate": m["cod_mate"],
                    "items": self._parse_materiales_clase(html),
                })
            except EducalinksError:
                resultado.append({"materia": m["nombre"], "cod_mate": m["cod_mate"],
                                  "items": []})
        return resultado

    @staticmethod
    def _parse_materiales_clase(html):
        import base64
        soup = BeautifulSoup(html, "lxml")
        items = []
        for card in soup.select('div.md-card[id^="div_card_"]'):
            codi = card.get("id", "").replace("div_card_", "")
            h4 = card.select_one("h4.title") or card.select_one("h4")
            detalle_p = None
            for p in card.find_all("p"):
                txt = p.get_text(" ", strip=True)
                if txt:
                    detalle_p = txt
                    break
            fecha = ""
            fecha_el = card.find(string=re.compile(r"Publicado el"))
            if fecha_el:
                fecha = fecha_el.parent.get_text(strip=True).replace("Publicado el:", "").strip()
            archivos = []
            for arc in re.findall(r"modListaMateriales\('([^']+)'\)", str(card)):
                for fname in arc.split(";"):
                    fname = fname.strip()
                    if not fname:
                        continue
                    b64 = base64.b64encode(fname.encode("utf-8")).decode("ascii")
                    archivos.append({
                        "nombre": fname,
                        "url": f"https://storage-api.educalinks.com.ec/descargar-archivo/{b64}",
                    })
            titulo = h4.get_text(strip=True) if h4 else ""
            if not codi and not titulo:
                continue
            items.append({
                "codi": codi,
                "titulo": h4.get_text(strip=True) if h4 else "",
                "detalle": detalle_p or "",
                "publicado_en": fecha,
                "archivos": archivos,
            })
        return items

    def descargar_pdf(self, url):
        """Descarga un recurso autenticado (como la libreta PDF)."""
        if not self._logged_in:
            self.login()
        if url.startswith("/"):
            url = BASE_URL + url
        resp = self.session.get(url, timeout=60, stream=True)
        if resp.status_code != 200:
            raise EducalinksError(f"Error {resp.status_code} al descargar el PDF")
        return resp

    def url_permitida(self, url):
        """Solo rutas relativas o del mismo dominio Educalinks (anti-SSRF)."""
        if not url:
            return False
        if url.startswith("/"):
            return True
        try:
            host = urlparse(url).netloc.lower()
        except ValueError:
            return False
        return host.endswith("educalinks.com.ec")


# ---------------------------------------------------------------------- #
# Utilidades de filtrado
# ---------------------------------------------------------------------- #
def semana_actual():
    """Devuelve (lunes, domingo) de la semana actual como date."""
    hoy = date.today()
    lunes = hoy - timedelta(days=hoy.weekday())
    return lunes, lunes + timedelta(days=6)


def filtrar_por_semana(eventos, desde=None, hasta=None):
    """Filtra eventos cuyo rango de fechas intersecta [desde, hasta]."""
    if desde is None or hasta is None:
        desde, hasta = semana_actual()

    def dentro(ev):
        if not ev["fecha_inicio"]:
            return False
        ini = date.fromisoformat(ev["fecha_inicio"])
        fin = date.fromisoformat(ev["fecha_fin"] or ev["fecha_inicio"])
        return ini <= hasta and fin >= desde

    filtrados = [ev for ev in eventos if dentro(ev)]
    filtrados.sort(key=lambda e: e["fecha_inicio"])
    return filtrados


# ---------------------------------------------------------------------- #
# Resumen de notas
# ---------------------------------------------------------------------- #
def calcular_resumen(eventos, libretas=None):
    """Promedios por materia (y por periodo) a partir de la agenda.

    Devuelve {"general": {...}, "materias": [...]}. Las calificaciones no
    numericas (como la "A" de comportamiento) se excluyen del promedio.
    """
    nombres_periodo = {
        l["peri_dist_codi"]: l["periodo"] for l in (libretas or [])
    }

    por_materia = {}
    for ev in eventos:
        nota = _a_float(ev.get("calificacion"))
        if nota is None:
            continue
        m = por_materia.setdefault(ev["materia"], {"notas": [], "periodos": {}})
        m["notas"].append(nota)
        peri = ev.get("periodo_codi") or "?"
        m["periodos"].setdefault(peri, []).append(nota)

    materias = []
    for nombre, datos in sorted(por_materia.items()):
        notas = datos["notas"]
        periodos = [{
            "codi": codi,
            "nombre": nombres_periodo.get(codi, f"Periodo {codi}"),
            "promedio": round(sum(ns) / len(ns), 2),
            "actividades": len(ns),
        } for codi, ns in sorted(datos["periodos"].items())]
        materias.append({
            "materia": nombre,
            "actividades": len(notas),
            "promedio": round(sum(notas) / len(notas), 2),
            "minima": min(notas),
            "maxima": max(notas),
            "periodos": periodos,
        })

    todas = [n for d in por_materia.values() for n in d["notas"]]
    general = {
        "promedio": round(sum(todas) / len(todas), 2) if todas else None,
        "total_calificadas": len(todas),
        "total_pendientes": sum(
            1 for ev in eventos if _a_float(ev.get("calificacion")) is None
        ),
    }
    return {"general": general, "materias": materias}


def _a_float(valor):
    if valor is None:
        return None
    try:
        return float(str(valor).replace(",", "."))
    except ValueError:
        return None  # notas cualitativas como "A"


# ---------------------------------------------------------------------- #
# Exportacion a iCalendar (.ics)
# ---------------------------------------------------------------------- #
def generar_ics(eventos):
    """Genera un archivo iCalendar con las actividades (eventos de dia completo)."""
    def esc(txt):
        return (txt or "").replace("\\", "\\\\").replace(";", "\\;") \
                          .replace(",", "\\,").replace("\n", "\\n")

    lineas = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//EducaFix//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:EducaFix — Colegio Americano",
        "X-PUBLISHED-TTL:PT12H",
    ]
    ahora = datetime.now().strftime("%Y%m%dT%H%M%S")
    for ev in eventos:
        if not ev["fecha_inicio"]:
            continue
        ini = date.fromisoformat(ev["fecha_inicio"])
        fin = date.fromisoformat(ev["fecha_fin"] or ev["fecha_inicio"])
        # En iCal, DTEND de evento de dia completo es exclusivo
        fin_excl = fin + timedelta(days=1)
        detalle = f"Estado: {ev['estado']}"
        if ev.get("calificacion"):
            detalle += f" | Nota: {ev['calificacion']}"
        lineas += [
            "BEGIN:VEVENT",
            f"UID:{ev['id']}@agenda-educalinks",
            f"DTSTAMP:{ahora}",
            f"DTSTART;VALUE=DATE:{ini.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{fin_excl.strftime('%Y%m%d')}",
            f"SUMMARY:{esc(ev['materia'])}: {esc(ev['titulo'])}",
            f"DESCRIPTION:{esc(detalle)}",
            # Alarma 16 h antes del inicio (08:00 del dia anterior)
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            "TRIGGER:-PT16H",
            f"DESCRIPTION:Recordatorio: {esc(ev['titulo'])}",
            "END:VALARM",
            "END:VEVENT",
        ]
    lineas.append("END:VCALENDAR")
    return "\r\n".join(lineas) + "\r\n"
