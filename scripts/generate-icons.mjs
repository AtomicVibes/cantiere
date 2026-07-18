import sharp from 'sharp';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = resolve(ROOT, 'public');

const MASTER_SVG = 'logo.svg';
const BRAND_RED_HEX = '#D51C39';
const BRAND_RED_RGB = { r: 213, g: 28, b: 57 };
const LOGO_PATHS_FILL = '#D51C39';

const SIZES = [192, 512];
const MASKABLE_SCALE = 0.8;

function log(msg) {
  console.log(`[icons] ${msg}`);
}

async function generateIcons() {
  const svgPath = resolve(PUBLIC, MASTER_SVG);
  if (!existsSync(svgPath)) {
    log(`ERROR: ${MASTER_SVG} not found at ${svgPath}`);
    process.exit(1);
  }

  const svg = readFileSync(svgPath, 'utf-8');

  const whiteSvg = svg.replace(new RegExp(LOGO_PATHS_FILL, 'g'), '#FFFFFF');

  for (const size of SIZES) {
    log(`Generating ${size}x${size} icons...`);

    const logoBuf = await sharp(Buffer.from(whiteSvg))
      .resize(size, size)
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
      .composite([{ input: logoBuf, top: 0, left: 0 }])
      .png()
      .toFile(resolve(PUBLIC, `icon-${size}.png`));
    log(`  ✓ icon-${size}.png (solid bg)`);

    const logoSize = Math.round(size * MASKABLE_SCALE);
    const padding = Math.round((size - logoSize) / 2);

    const maskableBuf = await sharp(Buffer.from(whiteSvg))
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
      .composite([{ input: maskableBuf, top: padding, left: padding }])
      .png()
      .toFile(resolve(PUBLIC, `maskable-icon-${size}.png`));
    log(`  ✓ maskable-icon-${size}.png (solid bg, safe-zone scaled)`);
  }

  log('Done — all icons regenerated with solid brand backgrounds.');
}

generateIcons().catch((err) => {
  console.error('[icons] Fatal error:', err);
  process.exit(1);
});
