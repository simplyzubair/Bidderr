const fs = require('fs');
const path = require('path');

// 1x1 base64 transparent PNG buffer or simple 32x32 PNG file
const minimalPngBase64 = 'iVBORw0KGgoAAAANSU5EUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAADFJREFUWI1jYBgFo2AUjIJRMApGwSigE/jPyMDwH4o/gLEp1YxRMApGwSigE/j/nzoAAPtWDApL+mtyAAAAAElFTkSuQmCC';

const buffer = Buffer.from(minimalPngBase64, 'base64');

const publicDir = path.join(__dirname, '../public');
const electronDir = path.join(__dirname, '../electron');

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

fs.writeFileSync(path.join(publicDir, 'icon.png'), buffer);
fs.writeFileSync(path.join(electronDir, 'tray_icon.png'), buffer);
console.log('Icons generated successfully.');
