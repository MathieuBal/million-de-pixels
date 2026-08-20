const numberFormat = new Intl.NumberFormat("fr-FR");

export function formatCount(value: number): string {
  return numberFormat.format(Math.round(value));
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
