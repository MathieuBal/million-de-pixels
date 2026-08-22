import { describe, expect, it } from "vitest";
import { Shaker } from "../../src/rendering/Shaker";

describe("Shaker", () => {
  it("does nothing until asked", () => {
    const shaker = new Shaker();
    expect(shaker.active).toBe(false);
    expect(shaker.offset()).toEqual({ x: 0, y: 0 });
  });

  it("moves the board while it lasts, and stops dead after", () => {
    const shaker = new Shaker();
    shaker.request(3, 90);
    shaker.update(16);
    const during = shaker.offset();
    expect(Math.abs(during.x) + Math.abs(during.y)).toBeGreaterThan(0);

    shaker.update(200);
    expect(shaker.active).toBe(false);
    expect(shaker.offset()).toEqual({ x: 0, y: 0 });
  });

  it("never stacks: two blasts in a frame do not shake twice as hard", () => {
    const shaker = new Shaker();
    shaker.request(2, 90);
    shaker.request(2, 90);
    shaker.update(16);
    const both = shaker.offset();

    const single = new Shaker();
    single.request(2, 90);
    single.update(16);

    expect(both).toEqual(single.offset());
  });

  it("lets a louder request take over a quieter one", () => {
    const shaker = new Shaker();
    shaker.request(1, 90);
    shaker.request(6, 200);
    shaker.update(16);
    expect(Math.max(Math.abs(shaker.offset().x), Math.abs(shaker.offset().y))).toBeGreaterThan(1);
  });

  it("decays rather than cutting off", () => {
    const shaker = new Shaker();
    shaker.request(8, 200);
    shaker.update(20);
    const early = Math.abs(shaker.offset().x) + Math.abs(shaker.offset().y);
    shaker.update(150);
    const late = Math.abs(shaker.offset().x) + Math.abs(shaker.offset().y);
    expect(late).toBeLessThanOrEqual(early);
  });

  it("never asks for a fractional pixel", () => {
    const shaker = new Shaker();
    shaker.request(3, 200);
    for (let i = 0; i < 10; i++) {
      shaker.update(16);
      const { x, y } = shaker.offset();
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });
});
