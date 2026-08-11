/**
 * Regenerates frontend/public/og-image.png — the 1200x630 Open Graph card
 * used by the social share tags in frontend/index.html.
 *
 * Not part of the build. Run it by hand when the art or the tagline changes,
 * then commit the resulting PNG:
 *
 *   node frontend/scripts/make-og-image.js
 *
 * Fonts: Quicksand and Nunito are loaded from Google Fonts at runtime in the
 * app, but this script rasterizes text, so it needs them on disk. If they
 * aren't installed system-wide, fetch the variable TTFs and point fontconfig
 * at them before running (the Google Fonts CSS API serves extension-less
 * woff2 URLs that fontconfig can't read, hence pulling from the repo):
 *
 *   mkdir -p /tmp/og-fonts
 *   curl -sL "https://github.com/google/fonts/raw/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf" -o /tmp/og-fonts/Quicksand.ttf
 *   curl -sL "https://github.com/google/fonts/raw/main/ofl/nunito/Nunito%5Bwght%5D.ttf" -o /tmp/og-fonts/Nunito.ttf
 *   printf '<?xml version="1.0"?><fontconfig><dir>/tmp/og-fonts</dir><dir>/usr/share/fonts</dir><cachedir>/tmp/og-fonts/cache</cachedir></fontconfig>' > /tmp/og-fonts.conf
 *   FONTCONFIG_FILE=/tmp/og-fonts.conf node frontend/scripts/make-og-image.js
 *
 * Colors come from frontend/DESIGN.md; the headline mirrors login.title in
 * frontend/src/i18n/locales/en.js, including the accented "chat" that
 * Login.jsx renders with titleAccent.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LOGO = path.join(ROOT, "src/img/logo.png");
const OUT = path.join(ROOT, "public/og-image.png");

const W = 1200, H = 630;
const BG = "#0e0e10";
const ACCENT = "#e11d76";
const ACCENT_LIGHT = "#f0429b";
const TEXT = "#efeff1";
const MUTED = "#adadb8";

const LOGO_SIZE = 340;
const LOGO_X = 745;
const LOGO_Y = Math.round((H - LOGO_SIZE) / 2);

const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${ACCENT}" stop-opacity="0.50"/>
      <stop offset="60%"  stop-color="${ACCENT}" stop-opacity="0.13"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${ACCENT_LIGHT}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${ACCENT_LIGHT}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${BG}"/>
  <!-- glow behind the avatar, echoing Login.jsx's hero radial-gradient -->
  <ellipse cx="${LOGO_X + LOGO_SIZE / 2}" cy="${H / 2}" rx="430" ry="380" fill="url(#glow)"/>
  <ellipse cx="150" cy="90" rx="420" ry="300" fill="url(#glow2)"/>

  <!-- brand lockup -->
  <text x="80" y="128" font-family="Quicksand" font-weight="700" font-size="34"
        fill="${ACCENT_LIGHT}" letter-spacing="0.5">VTAmigo</text>

  <!-- headline: mirrors login.title, with "chat" accented like titleAccent -->
  <text x="80" y="272" font-family="Quicksand" font-weight="700" font-size="58"
        fill="${TEXT}" letter-spacing="-1">An AI co-host that</text>
  <text x="80" y="340" font-family="Quicksand" font-weight="700" font-size="58"
        fill="${TEXT}" letter-spacing="-1">never misses <tspan fill="${ACCENT_LIGHT}">chat</tspan>.</text>

  <!-- tagline: condensed from login.subtitle -->
  <text x="80" y="410" font-family="Nunito" font-weight="400" font-size="25"
        fill="${MUTED}">Watches your Twitch chat, replies out loud,</text>
  <text x="80" y="446" font-family="Nunito" font-weight="400" font-size="25"
        fill="${MUTED}">and animates your avatar.</text>

  <!-- footer url -->
  <rect x="80" y="516" width="46" height="4" rx="2" fill="${ACCENT}"/>
  <text x="80" y="562" font-family="Quicksand" font-weight="600" font-size="24"
        fill="${TEXT}">vtamigo.top</text>
</svg>`;

(async () => {
  const logo = await sharp(LOGO)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const info = await sharp(Buffer.from(bg))
    .composite([{ input: logo, left: LOGO_X, top: LOGO_Y }])
    .png({ compressionLevel: 9 })
    .toFile(OUT);

  console.log(`wrote ${OUT} — ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)} KB`);
})();
