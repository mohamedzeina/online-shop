/* eslint-disable no-console */
// Snapshot script — captures README screenshots of the running app.
//
// Usage:
//   1. Start the app in another terminal:  npm run dev
//   2. Run:                                npm run snapshot
//
// Configurable via env vars:
//   SNAPSHOT_BASE_URL      default https://localhost:3000
//   SNAPSHOT_USER_EMAIL    customer login (skips auth-only shots if absent)
//   SNAPSHOT_USER_PASSWORD
//   SNAPSHOT_ADMIN_EMAIL   admin login (skips admin-only shots if absent)
//   SNAPSHOT_ADMIN_PASSWORD
//   SNAPSHOT_OUT           output dir, default docs/screenshots
//   SNAPSHOT_WIDTH         viewport width, default 1440
//   SNAPSHOT_HEIGHT        viewport height, default 900
//   SNAPSHOT_FULL_PAGE     "1" to capture full scroll, default "0"
//
// Output: PNG files in SNAPSHOT_OUT plus a Markdown manifest (INDEX.md).

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE_URL = (process.env.SNAPSHOT_BASE_URL || 'https://localhost:3000').replace(/\/$/, '');
const OUT_DIR  = process.env.SNAPSHOT_OUT || path.join('docs', 'screenshots');
const WIDTH    = parseInt(process.env.SNAPSHOT_WIDTH  || '1440', 10);
const HEIGHT   = parseInt(process.env.SNAPSHOT_HEIGHT || '900',  10);
const FULL     = process.env.SNAPSHOT_FULL_PAGE === '1';

const CREDS = {
  user:  { email: process.env.SNAPSHOT_USER_EMAIL,  password: process.env.SNAPSHOT_USER_PASSWORD  },
  admin: { email: process.env.SNAPSHOT_ADMIN_EMAIL, password: process.env.SNAPSHOT_ADMIN_PASSWORD },
};

// ─── Shot definitions ─────────────────────────────────────
// Each shot: { name, url, label, auth?, setup? }
// - auth: 'user' | 'admin' to require a session before this shot
// - setup(page): runs after navigation, before the screenshot
const SHOTS = [
  { name: 'homepage',         url: '/',                          label: 'Homepage with hero and paginated catalog' },
  { name: 'category',         url: '/category/electronics',      label: 'Category browse with chip filters and sort' },
  { name: 'product-detail',   url: '__FIRST_PRODUCT__',          label: 'Product detail with 3D viewer toggle and reviews' },
  { name: 'search',           url: '/search?q=lamp',             label: 'Full-text search results' },
  { name: 'login',            url: '/login',                     label: 'Customer sign-in' },
  { name: 'signup',           url: '/signup',                    label: 'Customer registration with avatar upload' },
  { name: 'admin-login',      url: '/admin/login',               label: 'Admin sign-in' },
  { name: 'error-404',        url: '/this-route-does-not-exist', label: '404 page' },

  // Auth-required shots
  { name: 'cart-drawer',      url: '/',               auth: 'user',  label: 'Slide-out cart drawer',
    async setup(page) { await openCartDrawer(page); } },
  { name: 'wishlist',         url: '/wishlist',       auth: 'user',  label: 'Wishlist with one-click removal' },
  { name: 'checkout',         url: '/checkout',       auth: 'user',  label: 'Checkout with stock-aware quantity controls' },
  { name: 'orders',           url: '/orders',         auth: 'user',  label: 'Order history with status filters' },
  { name: 'order-detail',     url: '__FIRST_ORDER__', auth: 'user',  label: 'Order detail with downloadable invoice' },
  { name: 'profile',          url: '/profile',        auth: 'user',  label: 'Tabbed profile (info, address, security)' },

  // Admin-required shots
  { name: 'admin-dashboard',  url: '/admin/dashboard', auth: 'admin', label: 'Admin dashboard: KPIs, top products, revenue chart' },
  { name: 'admin-products',   url: '/admin/products',  auth: 'admin', label: 'Admin product list with category filter' },
  { name: 'admin-orders',     url: '/admin/orders',    auth: 'admin', label: 'Admin order management with state-machine actions' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page, role) {
  const { email, password } = CREDS[role];
  if (!email || !password) return false;
  const loginUrl = role === 'admin' ? '/admin/login' : '/login';
  await page.goto(BASE_URL + loginUrl, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('form button[type="submit"], form [type="submit"]'),
  ]);
  const landed = new URL(page.url()).pathname;
  return !landed.endsWith('/login');
}

async function openCartDrawer(page) {
  await page.click('#cart-drawer-toggle');
  await page.waitForSelector('#cart-drawer.open', { timeout: 4000 });
  // Wait for the drawer body to populate (empty-state or items list)
  await page.waitForFunction(
    () => {
      const body = document.getElementById('cart-drawer-body');
      return body && body.children.length > 0;
    },
    { timeout: 4000 },
  ).catch(() => {});
  await sleep(400);
}

async function firstHref(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.getAttribute('href') : null;
  }, selector);
}

async function resolveSpecialUrl(page, raw) {
  if (raw === '__FIRST_PRODUCT__') {
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle2' });
    return (await firstHref(page, 'a[href^="/products/"]')) || '/';
  }
  if (raw === '__FIRST_ORDER__') {
    await page.goto(BASE_URL + '/orders', { waitUntil: 'networkidle2' });
    return (await firstHref(page, 'a[href^="/orders/"]')) || '/orders';
  }
  return raw;
}

async function capture(shot, sessions) {
  const role = shot.auth;
  if (role && !sessions[role]) {
    console.log(`  • skip ${shot.name} (no ${role} credentials)`);
    return false;
  }
  const ctx = role ? sessions[role] : sessions.anon;
  const page = await ctx.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

  try {
    const url = await resolveSpecialUrl(page, shot.url);
    const resp = await page.goto(BASE_URL + url, { waitUntil: 'networkidle2', timeout: 30000 });
    if (shot.setup) await shot.setup(page);
    // Let staggered fade-up animations settle
    await sleep(700);

    const outPath = path.join(OUT_DIR, `${shot.name}.png`);
    await page.screenshot({ path: outPath, fullPage: FULL });
    const status = resp ? resp.status() : '?';
    console.log(`  ✓ ${shot.name.padEnd(20)} → ${outPath}  (${status})`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${shot.name.padEnd(20)} — ${err.message.split('\n')[0]}`);
    return false;
  } finally {
    await page.close();
  }
}

async function buildSession(browser, role) {
  if (!CREDS[role].email) return null;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  const ok = await login(page, role);
  await page.close();
  if (!ok) {
    console.log(`  ! ${role} login failed — auth-required shots will be skipped`);
    await ctx.close();
    return null;
  }
  console.log(`  ✓ logged in as ${role}`);
  return ctx;
}

function buildGallery(captured) {
  const lines = [];
  for (const s of captured) {
    const rel = path.join(OUT_DIR, `${s.name}.png`).replace(/\\/g, '/');
    lines.push(`### ${s.label}`);
    lines.push('');
    lines.push(`![${s.label}](${rel})`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

function writeManifest(captured) {
  const header = [
    '# Screenshots',
    '',
    `_Generated by \`npm run snapshot\` — ${new Date().toISOString()}_`,
    '',
  ];
  fs.writeFileSync(
    path.join(OUT_DIR, 'INDEX.md'),
    header.join('\n') + buildGallery(captured),
  );
}

const README_START = '<!-- snapshots:start -->';
const README_END   = '<!-- snapshots:end -->';

function updateReadme(captured) {
  const readmePath = 'README.md';
  if (!fs.existsSync(readmePath)) return false;
  const src = fs.readFileSync(readmePath, 'utf8');
  const startIdx = src.indexOf(README_START);
  const endIdx   = src.indexOf(README_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.log(`  ! README has no ${README_START} / ${README_END} markers — skipped`);
    return false;
  }
  const before = src.slice(0, startIdx + README_START.length);
  const after  = src.slice(endIdx);
  const next   = before + '\n\n' + buildGallery(captured) + '\n' + after;
  if (next === src) return false;
  fs.writeFileSync(readmePath, next);
  return true;
}

async function main() {
  console.log(`Snapshot → ${BASE_URL}  (viewport ${WIDTH}×${HEIGHT}, fullPage=${FULL})`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--ignore-certificate-errors', '--no-sandbox'],
    ignoreHTTPSErrors: true,
  });

  // Probe the server before kicking off the run
  try {
    const probe = await browser.newPage();
    await probe.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 8000 });
    await probe.close();
  } catch (e) {
    console.error(`\n  Cannot reach ${BASE_URL}. Is the app running? (npm run dev)\n  ${e.message}\n`);
    await browser.close();
    process.exit(1);
  }

  const sessions = {
    anon:  await browser.createBrowserContext(),
    user:  null,
    admin: null,
  };
  console.log('Auth:');
  sessions.user  = await buildSession(browser, 'user');
  sessions.admin = await buildSession(browser, 'admin');

  console.log('Capturing:');
  const captured = [];
  for (const shot of SHOTS) {
    const ok = await capture(shot, sessions);
    if (ok) captured.push(shot);
  }

  writeManifest(captured);
  const readmeUpdated = updateReadme(captured);

  await browser.close();
  console.log(`\nDone. ${captured.length}/${SHOTS.length} captured.`);
  console.log(`Manifest: ${path.join(OUT_DIR, 'INDEX.md')}`);
  if (readmeUpdated) console.log('README.md gallery updated between snapshot markers.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
