"""Prueba get_materiales() del scraper: resumen en consola + archivo de muestra."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scraper import EducalinksClient  # noqa: E402

c = EducalinksClient()
t0 = time.time()
mats = c.get_materiales()
n_items = sum(len(m["items"]) for m in mats)
n_con = sum(1 for m in mats if m["items"])
print(f"resultado: {len(mats)} clases | {n_con} con materiales | {n_items} items | {time.time()-t0:.1f}s")
for m in mats:
    if m["items"]:
        it = m["items"][0]
        print(f"  - [{m['materia']}] {len(m['items'])} items, ej: {it['titulo']} ({it['publicado_en']}) archivos={len(it['archivos'])}")

with open(os.path.join("..", "tools", "explorado", "materiales.json"), "w", encoding="utf-8") as f:
    json.dump(mats, f, ensure_ascii=False, indent=1)
print("guardado tools/explorado/materiales.json")

t0 = time.time()
mats2 = c.get_materiales()
print(f"cache segundo llamada: {time.time()-t0:.2f}s (debe ser instantaneo)")