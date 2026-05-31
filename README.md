# orient-ink-renderer

Server-side renderer that turns a **Design Studio JSON export** into a single
PNG. Uses **Konva running in Node** (via the `canvas` package) so transforms,
crop, and curve smoothing match the frontend canvas *by construction* — the
same engine lays things out on both sides.

Currently supports layer types: `image` (with `crop`) and `draw` (freehand
Konva line). `text` comes next.

## Setup

```bash
cd orient-ink-renderer
npm install
```

> `canvas` ships prebuilt binaries for common platforms. If install tries to
> compile from source on macOS, run:
> `brew install pkg-config cairo pango libpng jpeg giflib librsvg`

## Run the round-trip test

```bash
npm run render            # reads test.json -> writes out.png
npm run render my.json result.png
```

Open `out.png` and compare it against a frontend export
(`stage.toDataURL({ pixelRatio: 1 })`). They should overlay pixel-for-pixel.

## The one thing to verify first: rotation pivot

This renderer uses Konva's **default top-left origin** (rotation pivots around
the node's `x, y`). If your rotated layers land in the wrong spot, your
frontend likely positions nodes by their **center** (sets
`offsetX/offsetY = width/2, height/2`). In that case set
`rotateAroundCenter: true` in `src/render-test.ts` and re-run. Whichever makes
the overlay match is your real contract — lock it in.

## When you add `text`

Konva guarantees text **layout** parity, but final glyph **rasterization** uses
node-canvas's font engine, so:

- Drop the exact frontend font files into `fonts/` and `registerFont()` them in
  `konva-renderer.ts` before creating the stage.
- Use **static** font files (not variable fonts — node-canvas support is
  unreliable).
- Never let it fall back to a system font.

## Wrapping in NestJS later

`renderDesign(doc, opts)` in `src/render/konva-renderer.ts` is the whole core.
A Nest controller just needs to accept the JSON body and return
`render(...)` with `Content-Type: image/png`. No rendering logic moves.