/**
 * The only thing allowed to move the camera, and it is rationed.
 *
 * An ordinary impact never shakes: at hundreds a second the board would never
 * be still, and a permanent tremor is not an effect, it is a defect. Shake is
 * reserved for what is rare — a blast landing, a colour running out, the finale
 * arriving — so it keeps meaning "something happened" instead of "the game is
 * running".
 *
 * A request never adds to what is already playing: the loudest one wins and the
 * others are ignored. Two blasts in the same frame must not shake twice as
 * hard.
 */
export class Shaker {
  private amplitude = 0;
  private remainingMs = 0;
  private totalMs = 1;
  private phase = 0;

  /** Asks for a shake of `pixels` for `durationMs`. Louder wins. */
  request(pixels: number, durationMs: number): void {
    if (pixels <= this.amplitude && this.remainingMs > 0) return;
    this.amplitude = pixels;
    this.remainingMs = durationMs;
    this.totalMs = Math.max(1, durationMs);
    this.phase = 0;
  }

  update(deltaMs: number): void {
    this.remainingMs = Math.max(0, this.remainingMs - deltaMs);
    this.phase += deltaMs;
    if (this.remainingMs === 0) this.amplitude = 0;
  }

  get active(): boolean {
    return this.remainingMs > 0;
  }

  /**
   * The offset to add to the board's position, in screen pixels.
   *
   * Square: the board is a grid of squares and a circular wobble reads as a
   * different game. The two axes run at different rates so the motion does not
   * collapse onto a diagonal.
   */
  offset(): { x: number; y: number } {
    if (this.remainingMs === 0) return { x: 0, y: 0 };

    const decay = this.remainingMs / this.totalMs;
    const size = this.amplitude * decay;
    return {
      x: Math.round(Math.sin(this.phase * 0.09) * size),
      y: Math.round(Math.sin(this.phase * 0.13 + 1.7) * size),
    };
  }
}
