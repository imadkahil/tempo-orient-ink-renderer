/**
 * Mirror of the frontend's `font-catalog.ts`. The two MUST stay in sync —
 * every entry below must correspond to a real .ttf shipped under
 * `orient-ink-renderer/fonts/` AND `orient-ink/public/fonts/`. The renderer
 * registers from this list at boot (see ./fonts.ts) so node-canvas paints
 * the same glyphs the editor previews.
 */
export interface FontFace {
  family: string;
  weight: number;
  style: "normal" | "italic";
  file: string;
}

export const FONT_CATALOG: readonly FontFace[] = [
  { family: "DM Sans", weight: 400, style: "normal", file: "Dm-sans.ttf" },
  { family: "Poppins", weight: 400, style: "normal", file: "Poppins-Regular.ttf" },
  { family: "Poppins", weight: 600, style: "normal", file: "Poppins-SemiBold.ttf" },
] as const;
