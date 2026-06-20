"""Generate MzansiMoney PWA icons (indigo tile + white coin) as PNGs - stdlib only."""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public"
BG = (99, 102, 241)      # indigo-500
COIN = (245, 245, 245)   # near-white
RING = (79, 70, 229)     # indigo-600 accent


def png(size: int) -> bytes:
    cx = cy = size / 2
    r_out = size * 0.32
    r_in = size * 0.24
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # filter type 0
        for x in range(size):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = (dx * dx + dy * dy) ** 0.5
            if d <= r_in:
                rgb = COIN
            elif d <= r_out:
                rgb = RING
            else:
                rgb = BG
            rows.extend(rgb)
            rows.append(255)  # alpha

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(rows), 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        (OUT / f"icon-{size}.png").write_bytes(png(size))
        print(f"wrote public/icon-{size}.png")


if __name__ == "__main__":
    main()
