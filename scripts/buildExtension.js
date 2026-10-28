// Assembles the loadable browser extension in dist-extension/ (extension/ + shared engine + icon).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-extension');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'extension'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
fs.copyFileSync(path.join(root, 'shared', 'proposalEngine.js'), path.join(out, 'lib', 'proposalEngine.js'));
fs.copyFileSync(path.join(root, 'public', 'icon.png'), path.join(out, 'icon.png'));

console.log(`Extension built: ${out}\nLoad it via chrome://extensions > Developer mode > Load unpacked.`);
