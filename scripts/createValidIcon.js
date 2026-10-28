const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createValidPngBuffer(width, height) {
  // Pure JS uncompressed valid PNG generator
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA color type
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw pixel data: purple/indigo RGBA pixel with scanline filter 0
  const rawRow = Buffer.alloc(1 + width * 4);
  rawRow[0] = 0; // Filter type 0
  for (let x = 0; x < width; x++) {
    const idx = 1 + x * 4;
    rawRow[idx] = 99;    // Red
    rawRow[idx + 1] = 102; // Green
    rawRow[idx + 2] = 241; // Blue
    rawRow[idx + 3] = 255; // Alpha
  }

  const rawImageData = Buffer.concat(Array(height).fill(rawRow));
  const compressedData = zlib.deflateSync(rawImageData);
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = data.length;
  const chunk = Buffer.alloc(8 + length + 4);
  chunk.writeUInt32BE(length, 0);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type), data]));
  chunk.writeUInt32BE(crc, 8 + length);
  return chunk;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc = crc ^ byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

const iconBuffer = createValidPngBuffer(256, 256);
fs.writeFileSync(path.join(__dirname, '../public/icon.png'), iconBuffer);
fs.writeFileSync(path.join(__dirname, '../electron/tray_icon.png'), iconBuffer);
console.log('Valid PNG icons written successfully.');
