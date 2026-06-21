// Core renderer: Design Studio JSON -> PNG Buffer.
//
// Strategy: rebuild the design with Konva running in Node (backed by the
// `canvas` package). Because the SAME engine lays out and rasterizes both
// here and on the frontend, transforms/crop/curve-smoothing match by
// construction instead of being re-implemented by hand.

// Font registration MUST happen before any canvas is created — node-canvas
// silently ignores registerFont calls after the first Canvas exists. This
// side-effect import has to be first so the catalog is registered before
// `canvas` or `konva` get a chance to instantiate anything.
import "./fonts";

import { createCanvas, loadImage } from "canvas";
import Konva from "konva";

import {
  DesignDocument,
  DrawLayer,
  ImageLayer,
  TextLayer,
} from "./design-document";

// Make node-canvas downsample with its highest-quality resampler. Shrinking a
// large source into a small box in one pass aliases under the default 'good';
// 'best' (Lanczos-class) keeps fine detail. We patch Konva's canvas factory so
// EVERY canvas it creates — including the one toCanvas() builds for export —
// gets this on its 2D context. (no-op in a browser context.)
const konvaUtil = Konva.Util as unknown as {
  createCanvasElement: () => { getContext: (type: string) => unknown };
};
const originalCreateCanvasElement = konvaUtil.createCanvasElement;
konvaUtil.createCanvasElement = () => {
  const canvasEl = originalCreateCanvasElement();
  const ctx = canvasEl.getContext("2d") as {
    quality?: string;
    patternQuality?: string;
  } | null;
  if (ctx && "patternQuality" in ctx) {
    ctx.quality = "best";
    ctx.patternQuality = "best";
  }
  return canvasEl;
};

export interface RenderOptions {
  // Multiplies output resolution. canvas.width/height already encodes the
  // print size at the document's DPI, so 1 produces the print-ready file.
  pixelRatio?: number;
  /**
   * Internal supersampling factor. We render the stage at
   * `supersample × pixelRatio`, then high-quality downsample back to
   * `canvas × pixelRatio` for the output. The PNG dimensions are unchanged;
   * what fills them is built from more sub-pixel samples, so glyph edges and
   * image edges look as crisp as a HiDPI browser canvas would. Trade-off:
   * memory + CPU scale ~supersample². Default 2 is a sweet spot — visibly
   * sharper without a measurable performance cost on typical scenes. Set 1
   * to disable.
   */
  supersample?: number;
  // Toggle ONLY if the frontend positions nodes by their CENTER (i.e. it sets
  // offsetX/offsetY = width/2, height/2 so rotation pivots around the middle).
  // Konva's default — and this renderer's default — is top-left origin, so the
  // round-trip test will tell you which one your export uses. See README.
  rotateAroundCenter?: boolean;
  // Mask artwork to the design area (the printable region): anything spilling
  // outside is clipped to transparent, but the output keeps the FULL canvas
  // size so it stays aligned 1:1 with the mockup coordinate space. Default
  // true. Set false to draw the whole canvas unclipped (debugging placement).
  clipToDesignArea?: boolean;
  // Optional flat background fill (e.g. "#ffffff"). Default: transparent.
  background?: string;
}

export async function renderDesign(
  doc: DesignDocument,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const pixelRatio = opts.pixelRatio ?? 1;

  const stage = new Konva.Stage({
    width: doc.canvas.width,
    height: doc.canvas.height,
  });

  // Clip the layer to the printable region so artwork outside it is masked to
  // transparent, while the canvas itself stays full-size (1:1 with the mockup).
  const clipToArea = opts.clipToDesignArea !== false && doc.designArea;
  const layer = new Konva.Layer(
    clipToArea
      ? {
          clipX: doc.designArea!.x,
          clipY: doc.designArea!.y,
          clipWidth: doc.designArea!.width,
          clipHeight: doc.designArea!.height,
        }
      : undefined,
  );
  stage.add(layer);

  if (opts.background) {
    layer.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: doc.canvas.width,
        height: doc.canvas.height,
        fill: opts.background,
      }),
    );
  }

  // Painter's algorithm: draw low zIndex first so high zIndex lands on top.
  const ordered = [...doc.layers]
    .filter((l) => l.visible !== false)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  for (const l of ordered) {
    if (l.type === "image") {
      await addImageLayer(layer, l, opts);
    } else if (l.type === "draw") {
      addDrawLayer(layer, l);
    } else if (l.type === "text") {
      addTextLayer(layer, l);
    }
  }

  layer.draw();

  // SUPERSAMPLE: render the stage at supersample × pixelRatio, then high-quality
  // downsample to the declared output size. This buys browser-HiDPI-equivalent
  // anti-aliasing on the print file without inflating its declared dimensions.
  const supersample = Math.max(1, opts.supersample ?? 2);
  const supersampled = stage.toCanvas({
    pixelRatio: pixelRatio * supersample,
  }) as unknown as {
    width: number;
    height: number;
    toBuffer: (mime: string) => Buffer;
  };

  if (supersample === 1) {
    return supersampled.toBuffer("image/png");
  }

  const outWidth = Math.round(doc.canvas.width * pixelRatio);
  const outHeight = Math.round(doc.canvas.height * pixelRatio);
  const output = createCanvas(outWidth, outHeight);
  // node-canvas exposes its scaler quality through `quality`/`patternQuality`
  // (not the browser's `imageSmoothingQuality`). "best" = Lanczos-class; the
  // default "good" produces visibly softer text after the downscale. We also
  // keep imageSmoothingEnabled on for the same reason.
  const octx = output.getContext("2d") as unknown as CanvasRenderingContext2D & {
    quality?: string;
    patternQuality?: string;
  };
  octx.imageSmoothingEnabled = true;
  octx.quality = "best";
  octx.patternQuality = "best";
  octx.drawImage(
    supersampled as unknown as Parameters<typeof octx.drawImage>[0],
    0,
    0,
    outWidth,
    outHeight,
  );
  return output.toBuffer("image/png");
}

/**
 * MOCKUP PREVIEW pipeline (spec §6). Composites the print art onto the mug.
 * Render order: base mockup → artwork (scaled into `printRegionOnMug`) →
 * overlay → optional mask. The artwork is the EXACT print output (we reuse
 * renderDesign), so the print file and the preview can never drift. A mask, if
 * present, clips ONLY the artwork — the base and overlay stay intact — via a
 * cached group composited with destination-in.
 *
 * Coordinate spaces: the print art is rendered at the art-file size
 * (`doc.canvas`) and then drawn into `printRegionOnMug`, which is in
 * mug-native pixels. Everything else here is mug space.
 */
export async function renderMockupPreview(
  doc: DesignDocument,
  opts: RenderOptions = {},
): Promise<Buffer> {
  if (!doc.mockup) {
    throw new Error("renderMockupPreview requires doc.mockup");
  }
  const pixelRatio = opts.pixelRatio ?? 1;
  const { mockup } = doc;
  const region = doc.printRegionOnMug ?? {
    x: 0,
    y: 0,
    width: mockup.width,
    height: mockup.height,
  };

  // 1. The print art itself (transparent, at the art-file resolution). Reusing
  //    renderDesign guarantees the preview's artwork == the print output.
  const printPng = await renderDesign(doc, {
    pixelRatio,
    rotateAroundCenter: opts.rotateAroundCenter,
    clipToDesignArea: false,
  });
  const printImage = await loadImage(printPng);

  // 2. Build the mug stage at its native size.
  const stage = new Konva.Stage({ width: mockup.width, height: mockup.height });
  const layer = new Konva.Layer();
  stage.add(layer);

  if (opts.background) {
    layer.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: mockup.width,
        height: mockup.height,
        fill: opts.background,
      }),
    );
  }

  // Base mockup.
  const baseImage = await loadImage(await resolveImageSource(mockup.baseImage));
  layer.add(
    new Konva.Image({
      image: baseImage as unknown as CanvasImageSource,
      x: 0,
      y: 0,
      width: mockup.width,
      height: mockup.height,
    }),
  );

  // Artwork scaled into the print region (optionally clipped to a print shape).
  const artGroup = new Konva.Group();
  artGroup.add(
    new Konva.Image({
      image: printImage as unknown as CanvasImageSource,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    }),
  );
  if (mockup.maskImage) {
    const maskImage = await loadImage(
      await resolveImageSource(mockup.maskImage),
    );
    artGroup.add(
      new Konva.Image({
        image: maskImage as unknown as CanvasImageSource,
        x: 0,
        y: 0,
        width: mockup.width,
        height: mockup.height,
        globalCompositeOperation: "destination-in",
      }),
    );
    // Cache so destination-in composites WITHIN the group (masking only the
    // artwork) rather than against the base already on the layer.
    artGroup.cache({
      x: 0,
      y: 0,
      width: mockup.width,
      height: mockup.height,
      pixelRatio,
    });
  }
  layer.add(artGroup);

  // Overlay (fabric shadows/highlights) above the artwork.
  if (mockup.overlayImage) {
    const overlayImage = await loadImage(
      await resolveImageSource(mockup.overlayImage),
    );
    layer.add(
      new Konva.Image({
        image: overlayImage as unknown as CanvasImageSource,
        x: 0,
        y: 0,
        width: mockup.width,
        height: mockup.height,
      }),
    );
  }

  layer.draw();
  const nodeCanvas = stage.toCanvas({ pixelRatio }) as unknown as {
    toBuffer: (mime: string) => Buffer;
  };
  return nodeCanvas.toBuffer("image/png");
}

async function addImageLayer(
  layer: Konva.Layer,
  l: ImageLayer,
  opts: RenderOptions,
): Promise<void> {
  const source = await resolveImageSource(l.src);
  const image = await loadImage(source);

  const node = new Konva.Image({
    image: image as unknown as CanvasImageSource,
    x: l.x ?? 0,
    y: l.y ?? 0,
    width: l.width,
    height: l.height,
    scaleX: l.scaleX ?? 1,
    scaleY: l.scaleY ?? 1,
    rotation: l.rotation ?? 0,
    opacity: l.opacity ?? 1,
  });

  // Crop coords are in the original image's natural pixels; Konva scales the
  // cropped region into the node's width/height for us.
  if (l.crop) {
    node.crop({
      x: l.crop.x,
      y: l.crop.y,
      width: l.crop.width,
      height: l.crop.height,
    });
  }

  if (opts.rotateAroundCenter) {
    node.offsetX(node.width() / 2);
    node.offsetY(node.height() / 2);
  }

  layer.add(node);
}

/**
 * Konva.Text in Node uses node-canvas's font rendering. The frontend's web
 * fonts (DM Sans, Poppins) are registered from the shared catalog in ./fonts
 * (imported first in this file) so the glyphs match the editor.
 *
 * Wrapping is the subtle part: node-canvas's `measureText` differs from the
 * browser's, so letting Konva auto-wrap here would pick different line breaks
 * than the editor showed — taller blocks, overflow, cropping. The frontend
 * therefore FREEZES its wrapping at export (lines as explicit "\n", `wrap:
 * "none"`). We honor that here so line structure is identical; only sub-pixel
 * per-line centering and anti-aliasing can differ. `wrap` defaults to "word"
 * for older scenes that predate the freeze.
 */
function addTextLayer(layer: Konva.Layer, l: TextLayer): void {
  // Konva packs italic/bold into one CSS-ish fontStyle string ("italic bold").
  const fontStyle =
    [l.italic ? "italic" : "", (l.fontWeight ?? 400) >= 600 ? "bold" : ""]
      .filter(Boolean)
      .join(" ") || "normal";
  const node = new Konva.Text({
    text: l.text,
    x: l.x ?? 0,
    y: l.y ?? 0,
    width: l.width,
    fontFamily: l.fontFamily,
    fontSize: l.fontSize,
    fontStyle,
    align: l.align,
    lineHeight: l.lineHeight,
    fill: l.fill,
    wrap: l.wrap ?? "word",
    scaleX: l.scaleX ?? 1,
    scaleY: l.scaleY ?? 1,
    rotation: l.rotation ?? 0,
    opacity: l.opacity ?? 1,
  });
  layer.add(node);
}

function addDrawLayer(layer: Konva.Layer, l: DrawLayer): void {
  const line = new Konva.Line({
    points: l.points,
    x: l.x ?? 0,
    y: l.y ?? 0,
    stroke: l.stroke ?? "#000000",
    strokeWidth: l.strokeWidth ?? 2,
    lineCap: l.lineCap ?? "round",
    lineJoin: l.lineJoin ?? "round",
    tension: l.tension ?? 0,
    rotation: l.rotation ?? 0,
    scaleX: l.scaleX ?? 1,
    scaleY: l.scaleY ?? 1,
    opacity: l.opacity ?? 1,
  });
  layer.add(line);
}

// Returns something node-canvas `loadImage` accepts: remote URLs are fetched
// to a Buffer (most reliable across canvas versions); local paths and data
// URIs are passed through untouched.
async function resolveImageSource(src: string): Promise<Buffer | string> {
  if (!/^https?:\/\//i.test(src)) {
    return src; // local path or data: URI — loadImage handles these directly
  }
  if (typeof fetch !== "function") {
    throw new Error(
      "global fetch is unavailable — use Node 18+ or add a fetch polyfill.",
    );
  }
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`Failed to fetch image ${src}: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}