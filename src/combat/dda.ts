/**
 * Amanatides & Woo grid traversal, 2D.
 *
 * Walks exactly the cells a ray crosses, in order, with two comparisons and
 * one addition per cell. A projectile is a segment plus a colour — there is no
 * collider and no broadphase anywhere in the game.
 *
 * The visitor returns true to stop the traversal (the shot was absorbed).
 */
export type CellVisitor = (x: number, y: number, index: number) => boolean;

export function traverseGridDDA(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
  visit: CellVisitor,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;

  let cellX = Math.floor(x0);
  let cellY = Math.floor(y0);

  const endX = Math.floor(x1);
  const endY = Math.floor(y1);

  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);

  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy);

  let tMaxX: number;
  if (stepX > 0) tMaxX = (cellX + 1 - x0) / dx;
  else if (stepX < 0) tMaxX = (x0 - cellX) / -dx;
  else tMaxX = Number.POSITIVE_INFINITY;

  let tMaxY: number;
  if (stepY > 0) tMaxY = (cellY + 1 - y0) / dy;
  else if (stepY < 0) tMaxY = (y0 - cellY) / -dy;
  else tMaxY = Number.POSITIVE_INFINITY;

  // Guard against a numerical edge case turning into an infinite walk.
  const maxSteps = width + height + 4;

  for (let step = 0; step < maxSteps; step++) {
    if (cellX < 0 || cellY < 0 || cellX >= width || cellY >= height) return false;

    if (visit(cellX, cellY, cellY * width + cellX)) return true;

    if (cellX === endX && cellY === endY) return false;

    if (tMaxX < tMaxY) {
      cellX += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      cellY += stepY;
      tMaxY += tDeltaY;
    } else {
      // Exact corner crossing. Stepping both axes at once is the stable,
      // reproducible policy — picking one axis would depend on float noise.
      cellX += stepX;
      cellY += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
  }

  throw new Error("DDA exceeded safety step count");
}
