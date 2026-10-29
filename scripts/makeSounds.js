// Makes Bidderr's two short sounds (soft and quiet). Run: node scripts/makeSounds.js
//   writing.wav: two soft rising notes  -> "I'm writing your proposal"
//   done.wav:    a gentle 3-note chime   -> "Proposal is ready in the clipboard"
const fs = require('fs');
const path = require('path');

const RATE = 22050;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Adds a soft note (sine + a little overtone) starting at `start` seconds.
function note(out, freq, start, length, volume, decay) {
  const first = Math.floor(start * RATE);
  const count = Math.floor(length * RATE);
  for (let i = 0; i < count && first + i < out.length; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.008);
    const env = attack * Math.exp(-t * decay);
    out[first + i] += volume * env * (Math.sin(2 * Math.PI * freq * t) + 0.18 * Math.sin(4 * Math.PI * freq * t));
  }
}

function make(seconds, notes) {
  const out = new Float64Array(Math.floor(seconds * RATE));
  for (const n of notes) note(out, ...n);
  return wav(Array.from(out));
}

const dir = path.join(__dirname, '..', 'shared', 'sounds');
fs.mkdirSync(dir, { recursive: true });
// [frequency, start, length, volume, decay]
fs.writeFileSync(path.join(dir, 'writing.wav'), make(0.42, [
  [659.25, 0.0, 0.2, 0.22, 14], // E5
  [880.0, 0.11, 0.3, 0.22, 11], // A5
]));
fs.writeFileSync(path.join(dir, 'done.wav'), make(0.95, [
  [1046.5, 0.0, 0.8, 0.2, 6], // C6
  [1318.5, 0.08, 0.8, 0.18, 6], // E6
  [1568.0, 0.16, 0.8, 0.16, 5.5], // G6
]));
console.log('wrote shared/sounds/writing.wav and done.wav');
