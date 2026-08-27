#!/usr/bin/env node
/* pdf-smoke.js — exercises the PDF writer that lives inside index.html, in Node,
 * with no browser and no dependencies.
 *
 *   node test/pdf-smoke.js            build test/out/report.pdf and assert structure
 *   node test/pdf-smoke.js --keep     also leave the intermediate extract.js for inspection
 *
 * How it works: everything in index.html's <script> above the `@test-extract-end`
 * marker is free of parse-time DOM access, so it can be written to a temp module and
 * required directly. If you add DOM calls above that marker, this test breaks — which
 * is the point. Keep the PDF writer DOM-free.
 *
 * If you have qpdf and poppler installed the test will also run `qpdf --check` and
 * render pages to PNG so you can eyeball layout. Both are optional.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const MARKER = '@test-extract-end';

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('  pass  ' + label); }
  else { failures++; console.log('  FAIL  ' + label + (detail ? '  → ' + detail : '')); }
}

/* ---------- 1. extract ---------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = html.split('<script>');
if (scripts.length < 2) { console.error('No <script> block found in index.html'); process.exit(1); }
let js = scripts[1].split('</' + 'script>')[0];
if (js.indexOf(MARKER) < 0) {
  console.error('Marker ' + MARKER + ' missing from index.html — cannot extract safely.');
  process.exit(1);
}
js = js.slice(0, js.indexOf(MARKER));
// strip the opening comment delimiter left dangling by the split
js = js.replace(/\/\*\s*$/, '');

fs.mkdirSync(OUT, { recursive: true });
const modPath = path.join(OUT, 'extract.js');
fs.writeFileSync(modPath, js + '\nmodule.exports={Doc,buildPdf,freqTable,fileName,tw,wrapText,jpegInfo,setS:v=>{S=v;},getS:()=>S};\n');
const M = require(modPath);

/* ---------- 2. fixture state ---------- */
const jpg = fs.readFileSync(path.join(__dirname, 'fixture.jpg'));
const photo = () => new Blob([jpg], { type: 'image/jpeg' });

const logs = [];
for (let i = 1; i <= 22; i++) logs.push({ n: i, ok: true });
logs.push({
  n: 23, ok: false,
  defects: ['Sweep out of limit', 'Oversize branch / knot'],
  meas: 'sweep 62 mm/m', spec: 'max 40 mm/m',
  note: 'Mid-stem sweep on butt log. Operator cutting through the bend rather than docking at the change of direction. Raised with the processor operator on site; long note included here deliberately so the test exercises text wrapping and page breaking.',
  photos: [photo(), photo(), photo()]
});
logs.push({ n: 24, ok: false, defects: ['SED under spec'], meas: 'SED 11.8 cm', spec: 'min 14 cm', note: '', photos: [photo()] });
logs.push({ n: 25, ok: false, defects: ['Poor docking / ragged end', 'Excess bark'], meas: '', spec: '', note: 'Ragged docking on three consecutive stems.', photos: [] });

const STATE = {
  date: '2026-08-26',
  place: 'Test compartment, main landing beside the test track',
  assessor: 'Test Assessor',
  crew: 'Test Crew — harvester and processor',
  grade: 'S_SL_4.8_16',
  gps: { lat: -12.34567, lon: 123.45678, acc: 6.4, at: new Date().toISOString() },
  bracket: { sedmin: '14.2', sedmax: '31.8', ledmin: '18.0', ledmax: '44.5', lenmin: '5.5', lenmax: '5.6' },
  logs
};

/* ---------- 3. unit-ish checks ---------- */
console.log('\nText metrics and JPEG parsing');
check('tw() grows with string length', M.tw('WWWW', 10, false) > M.tw('ii', 10, false));
check('wrapText respects width', M.wrapText('a '.repeat(200), 10, false, 200).length > 5);
check('jpegInfo reads fixture dimensions', (() => {
  const i = M.jpegInfo(new Uint8Array(jpg));
  return i && i.w > 0 && i.h > 0 && (i.comps === 1 || i.comps === 3);
})(), JSON.stringify(M.jpegInfo(new Uint8Array(jpg))));

console.log('\nAggregation');
M.setS(STATE);
const freq = M.freqTable();
check('freqTable counts defects', freq.length === 5, JSON.stringify(freq));
check('freqTable sorted descending', freq.every((r, i) => i === 0 || freq[i - 1][1] >= r[1]));
check('fileName is filesystem-safe', /^[A-Za-z0-9._-]+\.pdf$/.test(M.fileName()), M.fileName());

/* ---------- 4. build the PDF ---------- */
(async () => {
  console.log('\nPDF construction');
  let u8;
  try { u8 = await M.buildPdf(); }
  catch (e) { check('buildPdf resolves', false, e.stack); return finish(); }

  const buf = Buffer.from(u8);
  const pdfPath = path.join(OUT, 'report.pdf');
  fs.writeFileSync(pdfPath, buf);

  const head = buf.subarray(0, 8).toString('latin1');
  const tail = buf.subarray(-320).toString('latin1');

  check('starts with %PDF header', head.startsWith('%PDF-1.'));
  check('ends with %%EOF', tail.trimEnd().endsWith('%%EOF'));
  check('has an xref table', tail.includes('xref') && tail.includes('startxref'));
  check('embeds images via DCTDecode', buf.includes(Buffer.from('/DCTDecode')));

  // startxref offset must point at the literal string "xref"
  const m = tail.match(/startxref\s+(\d+)/);
  check('startxref offset is correct', !!m && buf.subarray(Number(m[1]), Number(m[1]) + 4).toString('latin1') === 'xref',
    m ? 'offset ' + m[1] : 'no startxref');

  // every declared object offset must land on "N 0 obj"
  const xrefStart = m ? Number(m[1]) : -1;
  if (xrefStart > 0) {
    const xref = buf.subarray(xrefStart).toString('latin1');
    const rows = xref.split('\n').filter(l => /^\d{10} \d{5} n\s*$/.test(l));
    const bad = rows.filter((l, i) => {
      const off = Number(l.slice(0, 10));
      return !new RegExp('^' + (i + 1) + ' 0 obj').test(buf.subarray(off, off + 20).toString('latin1'));
    });
    check('all xref offsets resolve to their object', bad.length === 0, bad.length + ' bad of ' + rows.length);
  }

  check('file size is sane for email', buf.length > 20000 && buf.length < 8 * 1024 * 1024, buf.length + ' bytes');
  console.log('  ---   wrote ' + path.relative(ROOT, pdfPath) + ' (' + Math.round(buf.length / 1024) + ' KB)');

  /* ---------- 5. optional external validation ---------- */
  console.log('\nExternal validators (skipped if not installed)');
  tryTool('qpdf', () => {
    const out = execSync('qpdf --check "' + pdfPath + '"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    check('qpdf reports no syntax errors', /No syntax or stream encoding errors/.test(out));
  });
  tryTool('pdftotext', () => {
    const txt = execSync('pdftotext "' + pdfPath + '" -', { encoding: 'utf8' });
    check('assessor name appears in text layer', txt.includes('Test Assessor'));
    check('conformance figure appears', /8[0-9]%/.test(txt), txt.match(/\d+%/g));
  });
  tryTool('pdftoppm', () => {
    execSync('pdftoppm -png -r 60 "' + pdfPath + '" "' + path.join(OUT, 'page') + '"');
    const pages = fs.readdirSync(OUT).filter(f => f.startsWith('page') && f.endsWith('.png'));
    check('pages rendered to PNG for eyeballing', pages.length >= 2, pages.join(', '));
  });

  finish();
})();

function tryTool(bin, fn) {
  try { execSync('command -v ' + bin, { stdio: 'ignore' }); }
  catch (e) { console.log('  skip  ' + bin + ' not installed'); return; }
  try { fn(); } catch (e) { failures++; console.log('  FAIL  ' + bin + ' → ' + e.message.split('\n')[0]); }
}

function finish() {
  if (!process.argv.includes('--keep')) { try { fs.unlinkSync(modPath); } catch (e) {} }
  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'All checks passed.') + '\n');
  process.exit(failures ? 1 : 0);
}
