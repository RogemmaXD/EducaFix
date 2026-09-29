"""Exploracion de Educalinks para localizar material de clases.

Uso: desde backend/ ejecutar    venv\\Scripts\\python.exe ..\\tools\\explorar_materiales.py
Guarda copias de las paginas candidatas en tools/explorado/ para inspeccion.
Solo lectura (GET), con pausas para no molestar al portal.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from scraper import EducalinksClient, EducalinksError  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "explorado")
os.makedirs(OUT, exist_ok=True)

CANDIDATAS = [
    "/alumnos/",
    "/alumnos/index.php",
    "/alumnos/aula_virtual.php",
    "/alumnos/aulavirtual.php",
    "/alumnos/materias.php",
    "/alumnos/material.php",
    "/alumnos/materiales.php",
    "/alumnos/materia.php",
    "/alumnos/asignaturas.php",
    "/alumnos/contenido.php",
    "/alumnos/recursos.php",
    "/alumnos/classroom.php",
    "/alumnos/notas.php",
    "/alumnos/agenda_listado.php",
]


def nombre(path):
    return path.rstrip("/").replace("/", "_").replace(".php", "") + ".html"


def main():
    c = EducalinksClient()
    try:
        c.get_agenda()
    except EducalinksError as e:
        print("[login] FALLO:", e)
        return

    for p in CANDIDATAS:
        try:
            html = c._get(p)
            time.sleep(0.4)
            fn = os.path.join(OUT, nombre(p))
            with open(fn, "w", encoding="utf-8") as f:
                f.write(html)
            marca = ""
            low = html.lower()
            for kw in ("material", "aula", "archivo", "adjunto", "recurso", "descargar"):
                if kw in low:
                    marca += f" {kw}*"
            print(f"[ok] {p} len={len(html)} hits:{marca or ' -'}")
        except Exception as e:
            try:
                print(f"[--] {p}: {type(e).__name__}: {e}")
            except UnicodeEncodeError:
                print(f"[--] {p}: {type(e).__name__}")

    import re
    print("\n[enlaces interesantes encontrados]")
    vistos = set()
    for arch in os.listdir(OUT):
        with open(os.path.join(OUT, arch), encoding="utf-8") as f:
            txt = f.read()
        for m in re.finditer(r'href="([^"]+)"[^>]*>([^<]{0,80})', txt, re.I):
            href, texto = m.group(1), m.group(2).strip().lower()
            if any(k in (href.lower() + texto) for k in
                   ("materia", "material", "aula", "archiv", "recurso", "descargar", "contenido")):
                if href not in vistos and "javascript:" not in href:
                    vistos.add(href)
                    print("  ", href, "|", texto[:60])


if __name__ == "__main__":
    main()