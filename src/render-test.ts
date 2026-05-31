// Minimal round-trip harness:  node render-test.ts <input.json> <output.png>
// Reads a Design Studio export, renders it, writes a PNG. This is the spike
// that proves fidelity before wrapping the renderer in a NestJS controller.

import { readFileSync, writeFileSync } from "fs";

import { DesignDocument } from "./render/design-document";
import { renderDesign, renderMockupPreview } from "./render/konva-renderer";

async function main(): Promise<void> {
  const inPath = process.argv[2] ?? "test.json";
  const outPath = process.argv[3] ?? "out.png";
  const pixelRatio = Number(process.argv[4] ?? 1); // print-resolution dial

  const doc: DesignDocument = JSON.parse(readFileSync(inPath, "utf-8"));

  // 1. PRINT export — the transparent art file at `canvas` (art) dimensions.
  //    Layers are already in art space, so no design-area sub-clip is needed;
  //    the canvas bounds are the clip. (background omitted -> transparent.)
  const printPng = await renderDesign(doc, {
    pixelRatio,
    rotateAroundCenter: false, // flip to true if a layer looks rotated wrong
  });
  writeFileSync(outPath, printPng);

  // 2. MOCKUP PREVIEW — composite the print art onto the mug, if a mockup is
  //    attached. Written alongside the print file as *-preview.png.
  let previewNote = "";
  if (doc.mockup) {
    const previewPath = outPath.replace(/(\.png)?$/i, "-preview.png");
    const previewPng = await renderMockupPreview(doc, { pixelRatio });
    writeFileSync(previewPath, previewPng);
    previewNote =
      ` + preview ${previewPath} ` +
      `(${doc.mockup.width * pixelRatio}x${doc.mockup.height * pixelRatio})`;
  }

  // eslint-free standalone project — console is intentional here.
  // eslint-disable-next-line no-console
  console.log(
    `Rendered ${doc.layers.length} layers @ ${pixelRatio}x -> ${outPath} ` +
      `(${doc.canvas.width * pixelRatio}x${doc.canvas.height * pixelRatio})` +
      previewNote,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});