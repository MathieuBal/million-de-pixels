/** Synthetic RGBA fixtures. No file IO, no canvas: pure buffers. */
export function solidImage(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = a;
  }
  return data;
}

/** Vertical bands of the given colors, in order, left to right. */
export function bandedImage(
  width: number,
  height: number,
  colors: Array<[number, number, number]>,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const bandWidth = width / colors.length;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const band = Math.min(colors.length - 1, Math.floor(x / bandWidth));
      const [r, g, b] = colors[band];
      const p = (y * width + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  return data;
}

/** Horizontal greyscale gradient. */
export function gradientImage(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.round((x / (width - 1)) * 255);
      const p = (y * width + x) * 4;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return data;
}

/** Fully transparent image: must be rejected as a level. */
export function transparentImage(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

export function halfTransparentImage(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const visible = x < width / 2;
      data[p] = 200;
      data[p + 1] = 40;
      data[p + 2] = 40;
      data[p + 3] = visible ? 255 : 0;
    }
  }
  return data;
}
