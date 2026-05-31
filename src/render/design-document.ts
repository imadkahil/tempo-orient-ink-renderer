// Shape of the JSON exported by the Design Studio frontend.
// Keep this in sync with the frontend serializer — it is the contract between
// the canvas and this renderer.
//
// IMPORTANT (coordinate space): `canvas` is the ART FILE / print canvas, and
// all layer coordinates are in that space. The mug is only a preview backdrop
// with its own (independent) pixel size — `mockup` + `printRegionOnMug` say
// where the art file maps onto it. So:
//   • PRINT export  → render layers straight onto a `canvas`-sized transparent
//     PNG (renderDesign). No mug, no sub-clip — the canvas IS the print.
//   • PREVIEW export → render that print art, then scale/place it into
//     `printRegionOnMug` on the mug base, then overlay + optional mask
//     (renderMockupPreview).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MockupPreview {
  baseImage: string;
  overlayImage?: string;
  maskImage?: string;
  width: number;
  height: number;
}

export interface DesignDocument {
  version: string;
  mockupId: string;
  // The art file / print canvas — the coordinate space layers live in.
  canvas: { width: number; height: number };
  // Preview backdrop (own pixel size) + where the art file lands on it.
  mockup?: MockupPreview;
  printRegionOnMug?: Rect;
  designAreaMargins?: Record<string, number>;
  // Legacy: older exports put the print region in mug space here and stored
  // layers in mug space. Still honored by renderDesign's optional clip, but new
  // exports use canvas == art file + printRegionOnMug instead.
  designArea?: Rect;
  constraints?: {
    dpi?: number;
    [key: string]: unknown;
  };
  layers: Layer[];
}

export type Layer = ImageLayer | DrawLayer;

interface BaseLayer {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number; // degrees, Konva convention
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  zIndex?: number;
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  src: string; // URL, data URI, or local path
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
  // Crop is expressed in the ORIGINAL image's natural pixel coordinates.
  crop?: { x: number; y: number; width: number; height: number };
}

export interface DrawLayer extends BaseLayer {
  type: "draw";
  points: number[]; // [x1, y1, x2, y2, ...] in canvas coordinates
  stroke?: string;
  strokeWidth?: number;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  tension?: number; // 0 = straight segments, >0 = smoothed spline
}