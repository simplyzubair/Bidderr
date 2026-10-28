// Draws the Bidderr icon (green rounded square with a "B") as PNG files. Run: node scripts/makeIcon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GLYPH_B = ['11110', '10001', '10001', '11110', '10001', '10001', '11110'];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function drawIcon(size) {
  const radius = size * 0.22;
  const cell = Math.floor(size / 11);
  const gx = Math.floor((size - cell * 5) / 2);
  const gy = Math.floor((size - cell * 7) / 2);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // PNG filter byte
    for (let x = 0; x < size; x++) {
      // Inside the rounded square?
      const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
      const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
      const inside = dx * dx + dy * dy <= radius * radius;
      const col = Math.floor((x - gx) / cell);
      const line = Math.floor((y - gy) / cell);
      const ink = x >= gx && y >= gy && GLYPH_B[line]?.[col] === '1';
      if (!inside) row.push(0, 0, 0, 0);
      else if (ink) row.push(5, 46, 22, 255);
      else row.push(34, 197, 94, 255);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = path.join(__dirname, '..');
const outputs = [
  ['public/icon.png', 256],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
];
for (const [file, size] of outputs) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, drawIcon(size));
  console.log(`wrote ${file} (${size}px)`);
}
