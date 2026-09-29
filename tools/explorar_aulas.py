"""Recorre las clases detectadas y cuenta materiales por clase."""
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from scraper import EducalinksClient  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "explorado")
os.makedirs(OUT, exist_ok=True)


def main():
    c = EducalinksClient()
    c.get_agenda()
    html = c._get("/alumnos/materias.php")
    cards = re.findall(
        r"set_alumno_materia\((\d+),(\d+),(\d+),(\d+),(\d+),'([^']+)'\)", html
    )
    print("clases:", len(cards))
    total_con = 0
    muestras = []
    for cm, cmp_, acm, ac, cod, nom in cards:
        c.session.post(
            "https://americano.educalinks.com.ec/alumnos/script_set_alum.php",
            data={
                "opc": "set_alum_mate", "curs_mate": cm, "curs_mate_prof": cmp_,
                "alum_curs_mate": acm, "alum_curs": ac, "cod_mate": cod,
                "desc_mate": nom,
            },
            timeout=30,
        )
        time.sleep(0.6)
        av = c._get("/alumnos/aulavirtual/materiales/")
        calls = re.findall(r"view_material\((\d+)\)", av)
        tienes = "NO hay materiales disponibles" not in av or len(calls) > 0
        if calls or "No hay materiales" not in av:
            total_con += 1 if calls else 0
            fn = os.path.join(OUT, f"mat_{cod}.html")
            with open(fn, "w", encoding="utf-8") as f:
                f.write(av)
            muestras.append((nom, len(calls), fn))
        print(f"  {nom[:45]:<45} items(view_material): {len(calls)}")
    print("\nclases con material:", total_con)
    for nom, k, fn in muestras:
        print("  guardado:", fn, "|", nom, "|", k)


if __name__ == "__main__":
    main()