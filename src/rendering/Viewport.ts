import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Board units of clearance kept around the image so the rail — which sits
 * outside the 1024² grid — is still on screen at full zoom-out.
 */
export const RAIL_CLEARANCE = 22;

/** Screen pixels per board cell. One cell is one destructible pixel. */
export const MIN_PIXEL_SIZE_FACTOR = 0.9;
export const MAX_PIXEL_SIZE = 24;

/**
 * How far in the view starts. Balls are one cell across, so the opening view
 * has to be close enough that a destroyed pixel actually reads as an event.
 */
export const DEFAULT_ZOOM_FACTOR = 2.2;

/**
 * Camera over the board: a scale and a board point held at the centre of the
 * viewport.
 *
 * Deliberately free of any renderer import — it is pure geometry, so the
 * clamping and the zoom-under-cursor arithmetic can be tested without a GPU.
 */
export class Viewport {
  /** Screen pixels per board cell. */
  scale = 1;
  /** Board coordinates currently held at the centre of the visible area. */
  centerX = WORLD_WIDTH / 2;
  centerY = WORLD_HEIGHT / 2;

  private area: ScreenRect = { x: 0, y: 0, width: 1, height: 1 };

  get visibleArea(): ScreenRect {
    return { ...this.area };
  }

  /** Bounds of everything worth showing: the board plus the rail around it. */
  static contentMin(): number {
    return -RAIL_CLEARANCE;
  }

  static contentWidth(): number {
    return WORLD_WIDTH + RAIL_CLEARANCE * 2;
  }

  static contentHeight(): number {
    return WORLD_HEIGHT + RAIL_CLEARANCE * 2;
  }

  /** Scale at which the whole board and its rail fit in the visible area. */
  fitScale(): number {
    return Math.min(
      this.area.width / Viewport.contentWidth(),
      this.area.height / Viewport.contentHeight(),
    );
  }

  minScale(): number {
    return this.fitScale() * MIN_PIXEL_SIZE_FACTOR;
  }

  /**
   * Sets the screen rectangle the board is drawn into, keeping the current
   * framing. The board lives inside a DOM-defined box — the framed play area —
   * rather than filling the window, so the rect comes from the layout.
   */
  setArea(area: ScreenRect): void {
    this.area = {
      x: area.x,
      y: area.y,
      width: Math.max(1, area.width),
      height: Math.max(1, area.height),
    };
    this.setScale(this.scale);
  }

  /** Frames the whole board. */
  fit(): void {
    this.centerX = WORLD_WIDTH / 2;
    this.centerY = WORLD_HEIGHT / 2;
    this.setScale(this.fitScale());
  }

  /** Opening framing: centred, and already close enough to read pixels. */
  reset(): void {
    this.centerX = WORLD_WIDTH / 2;
    this.centerY = WORLD_HEIGHT / 2;
    this.setScale(this.fitScale() * DEFAULT_ZOOM_FACTOR);
  }

  setScale(scale: number): void {
    this.scale = clamp(scale, this.minScale(), MAX_PIXEL_SIZE);
    this.clampCenter();
  }

  /**
   * Zooms about a screen point, keeping the board cell under it fixed — the
   * behaviour a cursor or a pinch gesture implies.
   */
  zoomAt(factor: number, screenX: number, screenY: number): void {
    const boardX = this.toBoardX(screenX);
    const boardY = this.toBoardY(screenY);

    this.scale = clamp(this.scale * factor, this.minScale(), MAX_PIXEL_SIZE);

    // Re-derive the centre so the anchor lands back under the same screen point.
    this.centerX = boardX + (this.area.x + this.area.width / 2 - screenX) / this.scale;
    this.centerY = boardY + (this.area.y + this.area.height / 2 - screenY) / this.scale;
    this.clampCenter();
  }

  /** Drags the view by a screen-space delta. */
  panBy(deltaScreenX: number, deltaScreenY: number): void {
    this.centerX -= deltaScreenX / this.scale;
    this.centerY -= deltaScreenY / this.scale;
    this.clampCenter();
  }

  toBoardX(screenX: number): number {
    return (screenX - this.offsetX()) / this.scale;
  }

  toBoardY(screenY: number): number {
    return (screenY - this.offsetY()) / this.scale;
  }

  /** Screen position of board origin — what the render container is set to. */
  offsetX(): number {
    return this.area.x + this.area.width / 2 - this.centerX * this.scale;
  }

  offsetY(): number {
    return this.area.y + this.area.height / 2 - this.centerY * this.scale;
  }

  /**
   * Keeps the centre inside the content, so the board can never be dragged
   * off screen entirely. When the content is smaller than the viewport on an
   * axis, it is simply centred on that axis.
   */
  private clampCenter(): void {
    const halfW = this.area.width / 2 / this.scale;
    const halfH = this.area.height / 2 / this.scale;

    const min = Viewport.contentMin();
    const maxX = min + Viewport.contentWidth();
    const maxY = min + Viewport.contentHeight();

    this.centerX =
      halfW * 2 >= Viewport.contentWidth()
        ? WORLD_WIDTH / 2
        : clamp(this.centerX, min + halfW, maxX - halfW);

    this.centerY =
      halfH * 2 >= Viewport.contentHeight()
        ? WORLD_HEIGHT / 2
        : clamp(this.centerY, min + halfH, maxY - halfH);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return value < min ? min : value > max ? max : value;
}
