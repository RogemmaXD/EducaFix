"""Explorador del portal DOCENTE de Educalinks (solo lectura).

Cuando consigas credenciales de un docente real:

    backend\\venv\\Scripts\\python tools\\explorar_docentes.py USUARIO CLAVE

El script inicia sesion con perfil Docentes (tipo=3), descubre el menu de
/docentes/index.php y guarda cada pagina en tools/explorado/doc_<nombre>.html
para poder escribir selectores exactos de los scrapers (igual que hicimos
con el portal de alumnos). Nunca escribe nada en Educalinks.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from scraper import EducalinksClient, EducalinksError  # noqa: E402

DESTINO = Path(__file__).resolve().parent / "explorado"


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    usuario, clave = sys.argv[1], sys.argv[2]
    cliente = EducalinksClient(user=usuario, password=clave, tipo="3")
    try:
        cliente.login()
    except EducalinksError as exc:
        print("Login fallido:", exc)
        return 1
    print("Sesion docente OK:", cliente.perfil_portal)
    DESTINO.mkdir(exist_ok=True)

    def guardar(nombre, html):
        ruta = DESTINO / f"doc_{nombre}.html"
        ruta.write_text(html, encoding="utf-8")
        print(f"  guardado {ruta.name} ({len(html)} bytes)")

    html = cliente._get("/docentes/index.php")
    guardar("index", html)

    # descubrir el menu del index
    from bs4 import BeautifulSoup  # noqa: E402
    soup = BeautifulSoup(html, "lxml")
    vistos = set()
    for a in soup.select("a[href*='.php']"):
        href = (a.get("href") or "").strip()
        nombre = a.get_text(" ", strip=True)
        if (not href or href in vistos or "salir" in href
                or "admin_pass" in href or href.startswith("#")):
            continue
        vistos.add(href)
        ruta_abs = cliente._doc_abs(href)
        if not ruta_abs.startswith("/"):
            print("  (externa, omitida)", href)
            continue
        time.sleep(0.4)
        try:
            pagina = cliente._get(ruta_abs)
            guardar(href.replace("/", "_").replace(".php", ""), pagina)
        except EducalinksError as exc:
            print(f"  {href}: {exc}")
    print("\nListo. Con esas muestras se refinan los scrapers de docentes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
