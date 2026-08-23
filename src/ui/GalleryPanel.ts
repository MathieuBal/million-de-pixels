import type { GameController } from "../app/GameController";
import { THUMBNAIL_SIZE, decodeThumbnail, type ImageRecord } from "../progression/ImageGallery";
import { formatCount } from "./format";

/**
 * Les toiles déjà jouées, sur l'écran d'accueil.
 *
 * C'est la seule décision du jeu qui ne soit pas un nombre à faire monter :
 * rejouer celle-ci pour battre son temps, ou en importer une neuve pour ses
 * teintes. Mesuré avant qu'elle existe, trois stratégies opposées de l'arbre
 * permanent finissaient à moins d'un pour cent l'une de l'autre — sept nœuds
 * qui multiplient chacun quelque chose ne font pas sept choix.
 *
 * La grille reste cachée tant qu'aucune image n'a été jouée : un accueil qui
 * montre une case vide promet quelque chose au lieu de dire quoi faire.
 */
export class GalleryPanel {
  private readonly root = document.getElementById("gallery") as HTMLElement;
  private readonly count = document.getElementById("gallery-count") as HTMLElement;
  private readonly grid = document.getElementById("gallery-grid") as HTMLElement;
  /** Ce qui est affiché, pour ne pas reconstruire la grille sans raison. */
  private signature = "";

  constructor(private readonly game: GameController) {}

  /** Le chrono d'un passage, écrit comme un joueur le lit. */
  static clock(ms: number): string {
    const total = Math.round(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, "0")}` : `${seconds} s`;
  }

  render(): void {
    const images = this.game.getGallery().all();

    this.root.hidden = images.length === 0;
    if (images.length === 0) return;

    const signature = images
      .map((r) => `${r.id}:${r.clears}:${r.bestMs ?? "-"}:${r.lastPlayedAtMs}`)
      .join("|");
    if (signature === this.signature) return;
    this.signature = signature;

    this.count.textContent = `${images.length} image${images.length > 1 ? "s" : ""}`;
    this.grid.replaceChildren();
    for (const record of images) this.grid.appendChild(this.card(record));
  }

  private card(record: ImageRecord): HTMLElement {
    const card = document.createElement("figure");
    card.className = "gallery-card";
    card.dataset.id = record.id;

    const canvas = document.createElement("canvas");
    canvas.className = "gallery-thumb";
    canvas.width = THUMBNAIL_SIZE;
    canvas.height = THUMBNAIL_SIZE;
    this.paint(canvas, record);

    const caption = document.createElement("figcaption");
    // Never the file name alone: two exports of the same picture carry the same
    // name and the player tells them apart by what they did with them.
    const time = record.bestMs === null ? "jamais finie" : GalleryPanel.clock(record.bestMs);
    // Deux faits, pas trois : la carte fait cent-vingt pixels de texte et la
    // troisième colonne repartait à la ligne au milieu d'un mot. Le nombre de
    // couleurs est le moins utile des trois — la vignette le montre déjà.
    caption.innerHTML =
      `<span class="gallery-name">${escape(record.name)}</span>` +
      `<span class="gallery-time">${time}</span>` +
      `<span class="gallery-meta">${record.clears} passage${record.clears > 1 ? "s" : ""}` +
      ` · ${formatCount(record.shards)} ◆</span>`;
    card.title =
      `${record.name} — ${record.paletteSize} couleurs, ` +
      `${formatCount(record.playablePixels)} px jouables`;

    card.append(canvas, caption);
    return card;
  }

  /**
   * Peint la vignette depuis ses indices de palette.
   *
   * Les pastilles sont celles du plateau, pas une moyenne : une vignette qui
   * mélangerait deux teintes montrerait une couleur que l'image ne contient
   * pas, et c'est précisément ce dont le nuancier tient le compte.
   */
  private paint(canvas: HTMLCanvasElement, record: ImageRecord): void {
    const pixels = decodeThumbnail(record.thumbnail);
    const context = canvas.getContext("2d");
    if (!pixels || !context) return;

    const image = context.createImageData(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    for (let i = 0; i < pixels.length; i++) {
      const swatch = record.swatches[pixels[i]];
      const at = i * 4;
      // Une cellule hors palette est un trou de la silhouette, pas une couleur.
      image.data[at] = swatch?.r ?? 0;
      image.data[at + 1] = swatch?.g ?? 0;
      image.data[at + 2] = swatch?.b ?? 0;
      image.data[at + 3] = swatch ? 255 : 0;
    }
    context.putImageData(image, 0, 0);
  }
}

/** Le nom vient d'un fichier choisi par le joueur : il ne construit pas de HTML. */
function escape(text: string): string {
  const node = document.createElement("span");
  node.textContent = text;
  return node.innerHTML;
}
