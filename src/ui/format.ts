const numberFormat = new Intl.NumberFormat("fr-FR");

export function formatCount(value: number): string {
  return numberFormat.format(Math.round(value));
}

/** Compact form for the tight colour-stat blocks: 356 421 → 356k. */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits).replace(".", ",")} %`;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

export function cssColor(r: number, g: number, b: number): string {
  return `rgb(${r} ${g} ${b})`;
}

/**
 * Ink for a counter sitting on a coloured tile.
 *
 * The board palette comes from the player's image, so no contrast pairing can
 * be baked in: it has to be chosen per tile from the colour's luminance.
 */
export function inkOn(r: number, g: number, b: number): string {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#26303b" : "#f3d9a4";
}
