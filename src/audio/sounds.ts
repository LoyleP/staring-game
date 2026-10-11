/** Catalogue des sons. Les fichiers sont dans public/sounds (non versionnés tant que les droits ne sont pas tranchés). */
export interface SoundDef {
  id: string;
  label: string;
  url: string;
}

export const SOUNDS: SoundDef[] = Array.from({ length: 20 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return { id: `s${n}`, label: String(i + 1), url: `/sounds/s${n}.mp3` };
});
