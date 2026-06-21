/**
 * Boot-time font registration. Must be imported BEFORE any `canvas` is created
 * — node-canvas silently no-ops `registerFont` calls that arrive after the
 * first Canvas instance exists. The render module (`./konva-renderer.ts`)
 * therefore imports this file at the very top of its import list, ahead of
 * `canvas` and `konva`, so the register loop runs before Konva ever touches
 * a stage.
 */
import { registerFont } from "canvas";
import path from "path";

import { FONT_CATALOG } from "./font-catalog";

const FONTS_DIR = path.join(__dirname, "..", "..", "fonts");

for (const face of FONT_CATALOG) {
  registerFont(path.join(FONTS_DIR, face.file), {
    family: face.family,
    weight: String(face.weight),
    style: face.style,
  });
}
