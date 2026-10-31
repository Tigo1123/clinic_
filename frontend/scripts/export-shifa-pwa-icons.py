"""Recompose the approved raster symbol without drawing or recoloring it.

Requires Pillow. Run with --check to validate the committed exports without writes.
The source mark and all favicon/full-logo assets are left untouched.
"""
import argparse
import io
import json
import math
from pathlib import Path

from PIL import Image

BRAND = Path(__file__).resolve().parents[1] / "public" / "brand"
SOURCE = BRAND / "shifa-mark-light.png"
WHITE = (255, 255, 255, 255)


def bounds(points):
    return (min(x for x, _ in points), min(y for _, y in points),
            max(x for x, _ in points) + 1, max(y for _, y in points) + 1)


def foreground(image, *, colored=False, difference=8):
    """Visible ink after compositing, ignoring near-white antialiasing noise.

    Chroma separates the old colored mark from its baked neutral rounded tile.
    Non-background checks on the new files also include neutral edge pixels.
    """
    image = Image.alpha_composite(Image.new("RGBA", image.size, WHITE), image.convert("RGBA"))
    pixels = image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
    return [(index % image.width, index // image.width)
            for index, (red, green, blue, _) in enumerate(pixels)
            if (255 - min(red, green, blue) > difference
                and (not colored or max(red, green, blue) - min(red, green, blue) > 30))]


def describe(image):
    result = {"size": list(image.size), "alphaRange": list(image.convert("RGBA").getchannel("A").getextrema())}
    for label, colored, difference in [("coloredMark", True, 8), ("nonBackground", False, 8), ("allNonWhite", False, 0)]:
        points = foreground(image, colored=colored, difference=difference)
        left, top, right, bottom = bounds(points)
        result[label] = {
            "bounds": [left, top, right, bottom],
            "width": right - left, "height": bottom - top,
            "center": [(left + right) / 2, (top + bottom) / 2],
            "centerOffset": [(left + right - image.width) / 2, (top + bottom - image.height) / 2],
            "padding": {"left": left, "top": top, "right": image.width - right, "bottom": image.height - bottom},
            "pixels": len(points),
            "maxRadiusRatio": max(math.hypot(x + .5 - image.width / 2, y + .5 - image.height / 2) for x, y in points) / min(image.size)
        }
    return result


def compose(source, size, ink_height):
    source_box = bounds(foreground(source))
    scale = ink_height / (source_box[3] - source_box[1])
    # One uniform scale, ordinary raster interpolation, no filters/opacity/color edits.
    scaled = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
    scaled = Image.alpha_composite(Image.new("RGBA", scaled.size, WHITE), scaled)
    # The source has near-white matte residue around its transparent boundary.
    # Remove only that <= 8/255 white fringe, leaving the symbol's colors intact.
    pixels = scaled.load()
    for y in range(scaled.height):
        for x in range(scaled.width):
            if min(pixels[x, y][:3]) >= 247:
                pixels[x, y] = WHITE
    box = bounds(foreground(scaled, difference=0))
    position = (round((size - box[0] - box[2]) / 2), round((size - box[1] - box[3]) / 2))
    canvas = Image.new("RGBA", (size, size), WHITE)
    canvas.alpha_composite(scaled, position)
    return canvas


def exports():
    source = Image.open(SOURCE).convert("RGBA")
    for size in (192, 512):
        # These raster scales give even ink bounds and exactly equal padding.
        # The resulting symbol heights are approximately 80% of each canvas.
        height = {192: 156, 512: 409}[size]
        yield f"pwa-{size}x{size}.png", compose(source, size, height), "any"
        # Fit the actual contour, not merely a rectangular 10% inset. Include
        # every non-white antialias pixel, with margin inside the 40% safe radius.
        for height in range(round(size * .66), round(size * .50), -1):
            image = compose(source, size, height)
            points = foreground(image, difference=0)
            radius = max(math.hypot(x + .5 - size / 2, y + .5 - size / 2) for x, y in points)
            if radius <= size * .395:
                yield f"pwa-maskable-{size}x{size}.png", image, "maskable"
                break
        else:
            raise AssertionError("Cannot fit approved symbol inside Android safe zone")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    results = []
    for name, image, purpose in exports():
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        if args.check:
            actual = Image.open(BRAND / name).convert("RGBA")
            assert actual.size == image.size and actual.tobytes() == image.tobytes(), f"Export drift: {name}"
        else:
            (BRAND / name).write_bytes(output.getvalue())
        info = describe(image)
        assert info["alphaRange"] == [255, 255], name
        assert info["allNonWhite"]["centerOffset"] == [0, 0], name
        assert all(abs(n) <= 1.5 for n in info["coloredMark"]["centerOffset"]), name
        if purpose == "maskable":
            assert info["allNonWhite"]["maxRadiusRatio"] <= .395, name
        results.append({"file": name, "purpose": purpose, **info})
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
