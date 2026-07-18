import sharp from 'sharp';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public');

const BRAND_RED_HEX = '#D51C39';
const BRAND_DARK_HEX = '#272425';
const BRAND_RED_RGB = { r: 213, g: 28, b: 57 };
const MASKABLE_SCALE = 0.8;
const SIZES = [192, 512];

function log(msg) {
  console.log(`[icons] ${msg}`);
}

async function generateIcons() {
  const svgPath = resolve(PUBLIC, 'geometra.svg');
  if (!existsSync(svgPath)) {
    log('ERROR: geometra.svg not found. Run this script from the project root.');
    process.exit(1);
  }

  const svg = readFileSync(svgPath, 'utf-8');

  const redSvg = svg.replace(new RegExp(BRAND_DARK_HEX, 'g'), BRAND_RED_HEX);
  const whiteSvg = svg.replace(new RegExp(BRAND_DARK_HEX, 'g'), '#FFFFFF');

  for (const size of SIZES) {
    log(`Generating ${size}x${size} icons...`);

    await sharp(Buffer.from(redSvg))
      .resize(size, size)
      .png()
      .toFile(resolve(PUBLIC, `icon-${size}.png`));
    log(`  ✓ icon-${size}.png`);

    const logoSize = Math.round(size * MASKABLE_SCALE);
    const padding = Math.round((size - logoSize) / 2);

    const logoBuf = await sharp(Buffer.from(whiteSvg))
      .resize(logoSize, logoSize)
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { ...BRAND_RED_RGB, alpha: 1 },
      },
    })
      .composite([{ input: logoBuf, top: padding, left: padding }])
      .png()
      .toFile(resolve(PUBLIC, `maskable-icon-${size}.png`));
    log(`  ✓ maskable-icon-${size}.png`);
  }

  log('Done — all icons generated.');
}

generateIcons().catch((err) => {
  console.error('[icons] Fatal error:', err);
  process.exit(1);
});
