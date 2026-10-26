"""
Genera los iconos de la app a partir del logo (backend/letha/assets/letha.svg): letha.icns para el paquete de
macOS y letha.ico para los accesos directos y la ventana de Windows.

Uso: backend/.venv/Scripts/python.exe scripts/make_icons.py [--out DIR]
"""

import argparse
import re
import struct
import zlib
from pathlib import Path

import numpy as np
import pymupdf

ASSETS = Path(__file__).resolve().parent.parent / "backend" / "letha" / "assets"
SOURCE = ASSETS / "letha.svg"
# Plantilla de Apple: el cuadro ocupa 824 de 1024 px, así el icono mide lo mismo que los del sistema en el Dock
MAC_CANVAS, MAC_BODY = 1024, 824
ICNS_TYPES = {
    16: [b"icp4"],
    32: [b"icp5", b"ic11"],
    64: [b"icp6", b"ic12"],
    128: [b"ic07"],
    256: [b"ic08", b"ic13"],
    512: [b"ic09", b"ic14"],
    1024: [b"ic10"],
}
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 256)


def render(svg: str, size: int) -> np.ndarray:
    page = pymupdf.open(stream=svg.encode(), filetype="svg")[0]
    zoom = size / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=True)
    rgba = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 4).astype(np.float64)
    assert rgba.shape[:2] == (size, size), rgba.shape
    alpha = rgba[..., 3:4]
    # PyMuPDF entrega el color ya multiplicado por la transparencia; PNG y los iconos lo esperan sin multiplicar
    rgba[..., :3] = np.where(alpha > 0, np.clip(rgba[..., :3] * 255 / np.maximum(alpha, 1), 0, 255), 0)
    return rgba.round().astype(np.uint8)


def png(rgba: np.ndarray) -> bytes:
    height, width, _ = rgba.shape

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    rows = b"".join(b"\x00" + rgba[y].tobytes() for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def bmp(rgba: np.ndarray) -> bytes:
    height, width, _ = rgba.shape
    pixels = rgba[::-1][..., [2, 1, 0, 3]].tobytes()
    row = (width + 31) // 32 * 4
    mask = b"".join(np.packbits(rgba[y, :, 3] == 0).tobytes().ljust(row, b"\x00") for y in range(height - 1, -1, -1))
    header = struct.pack("<IiiHHIIiiII", 40, width, height * 2, 1, 32, 0, len(pixels) + len(mask), 0, 0, 0, 0)
    return header + pixels + mask


def mac_svg(svg: str) -> str:
    source_size = float(re.search(r'viewBox="0 0 ([\d.]+)', svg).group(1))
    body = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.DOTALL).group(1)
    offset, scale = (MAC_CANVAS - MAC_BODY) / 2, MAC_BODY / source_size
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{MAC_CANVAS}" height="{MAC_CANVAS}" '
            f'viewBox="0 0 {MAC_CANVAS} {MAC_CANVAS}"><g transform="translate({offset} {offset}) scale({scale})">'
            f"{body}</g></svg>")


def icns(svg: str) -> bytes:
    entries = b""
    for size, kinds in ICNS_TYPES.items():
        data = png(render(svg, size))
        entries += b"".join(kind + struct.pack(">I", len(data) + 8) + data for kind in kinds)
    return b"icns" + struct.pack(">I", len(entries) + 8) + entries


def ico(svg: str) -> bytes:
    # Los tamaños chicos van como mapa de bits: la ventana de Windows no siempre lee PNG dentro del icono
    images = [png(render(svg, size)) if size >= 256 else bmp(render(svg, size)) for size in ICO_SIZES]
    directory = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    for size, data in zip(ICO_SIZES, images):
        side = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", side, side, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return directory + b"".join(images)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ASSETS)
    args = parser.parse_args()
    svg = SOURCE.read_text(encoding="utf-8")
    (args.out / "letha.icns").write_bytes(icns(mac_svg(svg)))
    (args.out / "letha.ico").write_bytes(ico(svg))
    print("listo:", args.out / "letha.icns", args.out / "letha.ico")


if __name__ == "__main__":
    main()
