import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM_FACTOR,
  MAX_PIXEL_SIZE,
  Viewport,
} from "../../src/rendering/Viewport";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../src/core/constants";

describe("Viewport", () => {
  let viewport: Viewport;

  beforeEach(() => {
    viewport = new Viewport();
    // The framed play area, as the layout hands it over.
    viewport.setArea({ x: 20, y: 210, width: 390, height: 390 });
  });

  it("frames the whole board, rail included, when fitted", () => {
    viewport.fit();
    // Every corner of the content must be inside the visible area.
    const area = viewport.visibleArea;
    const left = viewport.offsetX() + Viewport.contentMin() * viewport.scale;
    const top = viewport.offsetY() + Viewport.contentMin() * viewport.scale;
    const right = left + Viewport.contentWidth() * viewport.scale;
    const bottom = top + Viewport.contentHeight() * viewport.scale;

    expect(left).toBeGreaterThanOrEqual(area.x - 0.5);
    expect(top).toBeGreaterThanOrEqual(area.y - 0.5);
    expect(right).toBeLessThanOrEqual(area.x + area.width + 0.5);
    expect(bottom).toBeLessThanOrEqual(area.y + area.height + 0.5);
  });

  it("opens closer than the fit, so a destroyed pixel is visible", () => {
    const fit = viewport.fitScale();
    viewport.reset();
    expect(viewport.scale).toBeCloseTo(fit * DEFAULT_ZOOM_FACTOR, 6);
    expect(viewport.scale).toBeGreaterThan(fit);
  });

  it("keeps the board cell under the cursor fixed while zooming", () => {
    viewport.reset();
    const screenX = 500;
    const screenY = 400;
    const before = { x: viewport.toBoardX(screenX), y: viewport.toBoardY(screenY) };

    viewport.zoomAt(1.6, screenX, screenY);

    expect(viewport.toBoardX(screenX)).toBeCloseTo(before.x, 6);
    expect(viewport.toBoardY(screenY)).toBeCloseTo(before.y, 6);
  });

  it("holds the anchor across a zoom in then out", () => {
    viewport.reset();
    const before = viewport.toBoardX(700);
    viewport.zoomAt(2, 700, 300);
    viewport.zoomAt(0.5, 700, 300);
    expect(viewport.toBoardX(700)).toBeCloseTo(before, 6);
  });

  it("never zooms past one cell per screen pixel limit", () => {
    for (let i = 0; i < 60; i++) viewport.zoomAt(1.5, 640, 450);
    expect(viewport.scale).toBe(MAX_PIXEL_SIZE);
  });

  it("never zooms out past the framing of the whole board", () => {
    for (let i = 0; i < 60; i++) viewport.zoomAt(0.5, 640, 450);
    expect(viewport.scale).toBeCloseTo(viewport.minScale(), 6);
  });

  it("pans in the direction of the drag", () => {
    viewport.reset();
    const before = viewport.toBoardX(640);
    viewport.panBy(100, 0); // dragging right reveals what is to the left
    expect(viewport.toBoardX(640)).toBeLessThan(before);
  });

  it("cannot drag the board out of sight", () => {
    viewport.reset();
    for (let i = 0; i < 200; i++) viewport.panBy(500, 500);

    const max = Viewport.contentMin() + Viewport.contentWidth();
    expect(viewport.centerX).toBeGreaterThanOrEqual(Viewport.contentMin());
    expect(viewport.centerX).toBeLessThanOrEqual(max);
    expect(viewport.centerY).toBeGreaterThanOrEqual(Viewport.contentMin());
  });

  it("centres the board on an axis where everything already fits", () => {
    viewport.fit();
    for (let i = 0; i < 50; i++) viewport.panBy(300, 300);
    // Fitted, the content is smaller than the viewport on at least one axis,
    // and that axis must stay centred rather than drift.
    const area = viewport.visibleArea;
    if (area.width / viewport.scale >= Viewport.contentWidth()) {
      expect(viewport.centerX).toBeCloseTo(WORLD_WIDTH / 2, 6);
    }
    if (area.height / viewport.scale >= Viewport.contentHeight()) {
      expect(viewport.centerY).toBeCloseTo(WORLD_HEIGHT / 2, 6);
    }
  });

  it("keeps the framing across a resize", () => {
    viewport.reset();
    viewport.zoomAt(1.5, 400, 300);
    const scale = viewport.scale;

    viewport.setArea({ x: 20, y: 210, width: 460, height: 460 });
    expect(viewport.scale).toBeCloseTo(scale, 6);
  });

  it("raises the floor when the window shrinks", () => {
    viewport.fit();
    viewport.setArea({ x: 0, y: 0, width: 120, height: 120 });
    // A smaller window means a smaller fit scale, and the current scale must
    // never sit below the new floor.
    expect(viewport.scale).toBeGreaterThanOrEqual(viewport.minScale() - 1e-9);
  });

  it("survives a degenerate viewport", () => {
    expect(() => viewport.setArea({ x: 0, y: 0, width: 0, height: 0 })).not.toThrow();
    expect(Number.isFinite(viewport.scale)).toBe(true);
    expect(Number.isFinite(viewport.offsetX())).toBe(true);
  });

  it("maps screen coordinates back to board cells", () => {
    viewport.reset();
    const x = viewport.offsetX() + 12 * viewport.scale;
    expect(viewport.toBoardX(x)).toBeCloseTo(12, 6);
  });
});
