const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const iconDir = path.join(__dirname, '..', 'build', 'icons');

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function readPng(filePath) {
  const data = fs.readFileSync(filePath);
  assert.deepEqual(data.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8;
  let header;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: chunk.readUInt32BE(0),
        height: chunk.readUInt32BE(4),
        bitDepth: chunk[8],
        colorType: chunk[9],
      };
    }
    if (type === 'IDAT') idat.push(chunk);
    offset += length + 12;
  }
  return { header, scanlines: zlib.inflateSync(Buffer.concat(idat)) };
}

function rgbaPixels({ header, scanlines }) {
  assert.equal(header.bitDepth, 8);
  assert.equal(header.colorType, 6, 'tray assets must retain RGBA transparency');
  const bytesPerPixel = 4;
  const stride = header.width * bytesPerPixel;
  const output = Buffer.alloc(stride * header.height);
  let sourceOffset = 0;
  for (let row = 0; row < header.height; row += 1) {
    const filter = scanlines[sourceOffset];
    sourceOffset += 1;
    for (let column = 0; column < stride; column += 1) {
      const raw = scanlines[sourceOffset + column];
      const left = column >= bytesPerPixel ? output[row * stride + column - bytesPerPixel] : 0;
      const above = row > 0 ? output[(row - 1) * stride + column] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? output[(row - 1) * stride + column - bytesPerPixel] : 0;
      const value = [raw, raw + left, raw + above, raw + Math.floor((left + above) / 2),
        raw + paeth(left, above, upperLeft)][filter];
      output[row * stride + column] = value & 0xff;
    }
    sourceOffset += stride;
  }
  return output;
}

function alphaValues(image) {
  const pixels = rgbaPixels(image);
  return Array.from({ length: image.header.width * image.header.height }, (_, index) => pixels[index * 4 + 3]);
}

test('dedicated tray template PNGs are compact RGBA assets with transparent padding', () => {
  const expected = [
    ['trayTemplate.png', 16],
    ['trayTemplate@2x.png', 32],
  ];
  for (const [name, size] of expected) {
    const image = readPng(path.join(iconDir, name));
    assert.deepEqual([image.header.width, image.header.height], [size, size]);
    const alphas = alphaValues(image);
    assert.ok(alphas.some((alpha) => alpha === 0), `${name} must keep transparent padding`);
    assert.ok(alphas.some((alpha) => alpha > 0), `${name} must contain visible pixels`);
  }
});

test('non-template tray icon has transparent padding and high-contrast color detail', () => {
  const image = readPng(path.join(iconDir, 'trayIcon.png'));
  assert.deepEqual([image.header.width, image.header.height], [32, 32]);
  const pixels = rgbaPixels(image);
  const visible = [];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] > 0) visible.push([pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
  }
  const luminance = visible.map(([red, green, blue]) => (
    0.2126 * red + 0.7152 * green + 0.0722 * blue
  ));

  assert.ok(visible.length > 0, 'trayIcon.png must contain visible pixels');
  assert.ok(visible.length < 32 * 32, 'trayIcon.png must retain transparent padding');
  assert.ok(new Set(visible.map((color) => color.join(','))).size >= 3,
    'trayIcon.png must use more than a single monochrome color');
  assert.ok(Math.min(...luminance) < 90 && Math.max(...luminance) > 180,
    'trayIcon.png must include both dark and bright edges for panel contrast');
  assert.ok(visible.some(([red, green, blue]) => Math.max(red, green, blue) - Math.min(red, green, blue) > 70),
    'trayIcon.png must include a clearly colored, non-template body');
});
