import type { Viewport } from "../rendering/Viewport";

/** Multiplier per wheel notch. Gentle enough to land on a chosen zoom. */
const WHEEL_STEP = 1.18;
const BUTTON_STEP = 1.5;

/**
 * Mouse, touch and keyboard control of the camera.
 *
 * Wheel and pinch zoom about the pointer rather than the centre, so the pixel
 * being watched stays put. Dragging pans. A drag is only treated as a pan once
 * it passes a small threshold, so clicking the board never nudges the view.
 */
export class ViewportControls {
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly viewport: Viewport,
    private readonly onChange: () => void,
  ) {
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
  }

  zoomIn(): void {
    this.zoomAtCentre(BUTTON_STEP);
  }

  zoomOut(): void {
    this.zoomAtCentre(1 / BUTTON_STEP);
  }

  fit(): void {
    this.viewport.fit();
    this.onChange();
  }

  private zoomAtCentre(factor: number): void {
    const area = this.viewport.visibleArea;
    this.viewport.zoomAt(factor, area.x + area.width / 2, area.y + area.height / 2);
    this.onChange();
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    this.viewport.zoomAt(factor, event.offsetX, event.offsetY);
    this.onChange();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      this.pinchDistance = this.currentPinchDistance();
      this.dragging = false;
      return;
    }

    this.dragging = true;
    this.moved = false;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0 && distance > 0) {
        const centre = this.pinchCentre();
        const rect = this.canvas.getBoundingClientRect();
        this.viewport.zoomAt(distance / this.pinchDistance, centre.x - rect.left, centre.y - rect.top);
        this.onChange();
      }
      this.pinchDistance = distance;
      return;
    }

    if (!this.dragging) return;

    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;

    if (!this.moved && Math.hypot(dx, dy) < 2) return;
    this.moved = true;
    this.canvas.style.cursor = "grabbing";

    this.viewport.panBy(dx, dy);
    this.onChange();
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    this.dragging = false;
    this.moved = false;
    this.canvas.style.cursor = "grab";
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    // Never hijack typing in a form control.
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

    switch (event.key) {
      case "+":
      case "=":
        this.zoomIn();
        break;
      case "-":
      case "_":
        this.zoomOut();
        break;
      case "0":
        this.fit();
        break;
      case "ArrowLeft":
        this.viewport.panBy(60, 0);
        this.onChange();
        break;
      case "ArrowRight":
        this.viewport.panBy(-60, 0);
        this.onChange();
        break;
      case "ArrowUp":
        this.viewport.panBy(0, 60);
        this.onChange();
        break;
      case "ArrowDown":
        this.viewport.panBy(0, -60);
        this.onChange();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pinchCentre(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  dispose(): void {
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
