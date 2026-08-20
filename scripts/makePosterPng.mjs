import zlib from "node:zlib";

/**
 * Poster-style anime illustration fixture, 9:16 portrait.
 *
 * Approximates the regime of a screen-printed character poster: a few flat
 * fields covering almost the whole surface, fine hatching that pulls in
 * intermediate tones, and one tiny bright detail. That last one is the case
 * the palette analyzer has to get right — it is a few thousand pixels out of a
 * million, and merging it away would erase a feature of the image.
 */
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const RED = [206, 41, 42];
const DEEP_RED = [150, 26, 30];
const CREAM = [237, 228, 206];
const INK = [26, 18, 20];
const HIGHLIGHT = [252, 246, 232];

export function posterPng(width = 736, height = 1308) {
  const raw = Buffer.alloc((width * 3 + 1) * height);

  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * (width * 3 + 1) + 1 + x * 3;
    raw[p] = r;
    raw[p + 1] = g;
    raw[p + 2] = b;
  };

  const cx = width / 2;
  const faceTop = height * 0.16;
  const faceBottom = height * 0.52;
  const faceHalf = width * 0.29;

  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none

    for (let x = 0; x < width; x++) {
      // Flat crimson field behind everything.
      let color = RED;

      // Head and face: a large cream mass.
      const ny = (y - (faceTop + faceBottom) / 2) / ((faceBottom - faceTop) / 2);
      const nx = (x - cx) / faceHalf;
      if (nx * nx + ny * ny < 1) color = CREAM;

      // Spiked hair: cream wedges above the face.
      if (y < faceTop + height * 0.05) {
        const spike = Math.abs(Math.sin((x / width) * 22));
        if (y > faceTop - height * 0.11 * spike && Math.abs(nx) < 1.25) color = CREAM;
      }

      // Headband across the brow: deep red band with an ink emblem.
      if (y > faceTop + height * 0.055 && y < faceTop + height * 0.105 && Math.abs(nx) < 1.05) {
        color = DEEP_RED;
        const ex = (x - cx) / (width * 0.05);
        const ey = (y - (faceTop + height * 0.08)) / (height * 0.018);
        if (ex * ex + ey * ey < 1) color = INK;
      }

      // Collar and shoulders: a black mass filling the lower third.
      if (y > height * 0.5) {
        const shoulder = height * 0.5 + Math.abs(x - cx) * 0.35;
        if (y > shoulder) color = INK;
      }

      // Jacket panels: crimson over the black, leaving an ink outline.
      if (y > height * 0.72) {
        const inner = Math.abs(x - cx) > width * 0.09 && Math.abs(x - cx) < width * 0.42;
        if (inner && y > height * 0.74) color = RED;
      }

      // Hatching: thin deep-red lines that give the print its texture.
      if (color === RED && (x + y * 2) % 23 === 0 && y > height * 0.55) color = DEEP_RED;

      put(x, y, color);
    }
  }

  // Eyes: two small ink strokes, plus a highlight of a few thousand pixels.
  const eyeY = faceTop + height * 0.15;
  for (const side of [-1, 1]) {
    const ex = cx + side * width * 0.12;
    for (let y = -Math.round(height * 0.012); y <= Math.round(height * 0.012); y++) {
      for (let x = -Math.round(width * 0.055); x <= Math.round(width * 0.055); x++) {
        if ((x / (width * 0.055)) ** 2 + (y / (height * 0.012)) ** 2 > 1) continue;
        put(ex + x, eyeY + y, INK);
      }
    }
    // The catchlight: tiny, and nothing else in the image is this bright.
    for (let y = -3; y <= 3; y++) {
      for (let x = -4; x <= 4; x++) {
        put(ex + x - 6, eyeY + y - 3, HIGHLIGHT);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
