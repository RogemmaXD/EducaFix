"""Genera los iconos PWA (192 y 512 px) sin dependencias externas.

Dibuja: cuadrado naranja con esquinas redondeadas + tres barras blancas
(estilo agenda/lista). Se dibuja a 4x y se promedia el downsampling para
suavizar bordes.
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend" / "img"


def dentro_rounded(x, y, size, r):
    """Cuadrado con esquinas redondeadas centrado."""
    c = size / 2
    dx = abs(x - c)
    dy = abs(y - c)
    half = size / 2
    if dx <= half - r or dy <= half - r:
        return True
    qx = dx - (half - r)
    qy = dy - (half - r)
    return qx * qx + qy * qy <= r * r


def dentro_capsula(x, y, x0, x1, cy, r):
    """Barra horizontal con extremos redondeados."""
    if x < x0:
        return (x - x0) ** 2 + (y - cy) ** 2 <= r * r
    if x > x1:
        return (x - x1) ** 2 + (y - cy) ** 2 <= r * r
    return abs(y - cy) <= r


def png_escribir(ruta, pix, w, h):
    def chunk(tipo, datos):
        c = tipo + datos
        return struct.pack(">I", len(datos)) + c + struct.pack(
            ">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(fila) for fila in pix)
    data = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))
    ruta.write_bytes(data)


def generar(size):
    ss = 4  # supersampling
    n = size * ss
    bg, fg = (255, 92, 0, 255), (255, 255, 255, 255)
    r_sq = n * 0.18
    barras_y = [0.32, 0.50, 0.68]
    x0, x1 = n * 0.28, n * 0.72
    r_bar = n * 0.045

    pix = []
    for y in range(n):
        fila = []
        for x in range(n):
            color = (0, 0, 0, 0)
            if dentro_rounded(x + 0.5, y + 0.5, n, r_sq):
                color = bg
                for by in barras_y:
                    if dentro_capsula(x + 0.5, y + 0.5, x0, x1, n * by, r_bar):
                        color = fg
                        break
            fila.extend(color)
        pix.append(fila)

    # downsample promediando bloques ss x ss
    final = []
    for y in range(size):
        fila = []
        y0, y1 = y * ss, y * ss + ss
        for x in range(size):
            x0b, x1b = x * ss, x * ss + ss
            sr = sg = sb = sa = 0
            for yy in range(y0, y1):
                base = yy * n * 4
                for xx in range(x0b, x1b):
                    i = xx * 4
                    sr += pix[yy][i]; sg += pix[yy][i + 1]
                    sb += pix[yy][i + 2]; sa += pix[yy][i + 3]
            k = ss * ss
            fila.extend((sr // k, sg // k, sb // k, sa // k))
        final.append(fila)
    return final


OUT.mkdir(parents=True, exist_ok=True)
for s in (192, 512):
    png_escribir(OUT / f"icon-{s}.png", generar(s), s, s)
    print(f"icon-{s}.png generado ({(OUT / f'icon-{s}.png').stat().st_size} bytes)")
