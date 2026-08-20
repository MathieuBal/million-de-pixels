import zlib from "node:zlib";

/**
 * Minimal PNG encoder for test fixtures.
 * Avoids pulling an image library into the project just to make four squares.
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

/**
 * Four solid quadrants plus a tiny, unmistakably different speck — the "eyes"
 * case: about 0.2% of the image, which must survive palette detection as a
 * rare colour rather than being merged away.
 */
export function quadrantsPng(size = 256) {
  const colors = [
    [220, 40, 40],
    [40, 80, 220],
    [240, 210, 60],
    [30, 30, 30],
  ];

  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const quadrant = (y < size / 2 ? 0 : 2) + (x < size / 2 ? 0 : 1);
      const [r, g, b] = colors[quadrant];
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }

  // The speck: a bright magenta block no other quadrant comes close to.
  const speck = Math.max(2, Math.round(size * 0.045));
  for (let y = 0; y < speck; y++) {
    for (let x = 0; x < speck; x++) {
      const p = (y + (size >> 1) - (speck >> 1)) * (size * 3 + 1) + 1 + (x + (size >> 1) - (speck >> 1)) * 3;
      raw[p] = 240;
      raw[p + 1] = 40;
      raw[p + 2] = 200;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
