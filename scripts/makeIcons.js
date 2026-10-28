// Makes every icon from branding/logo.svg. Run: npm i --no-save sharp && node scripts/makeIcons.js
// (Android also gets a crisp adaptive vector icon in res/drawable, see ic_launcher_foreground.xml.)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const logo = path.join(root, 'branding', 'logo.svg');

const outputs = [
  ['public/icon.png', 256],
  ['public/tray.png', 32],
  ['website/icon.png', 256],
  ['android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
  ['android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
  ['android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
  ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
  ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
];

(async () => {
  for (const [file, size] of outputs) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await sharp(logo, { density: Math.max(72, (size / 512) * 72 * 4) }).resize(size, size).png().toFile(target);
    console.log(`wrote ${file} (${size}px)`);
  }
  fs.copyFileSync(logo, path.join(root, 'website', 'logo.svg'));
  console.log('copied website/logo.svg');
})();
