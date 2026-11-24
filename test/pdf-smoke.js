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
fs.writeFileSync(modPath, js + '\nmodule.exports={Doc,buildPdf,freqTable,fileName,tw,wrapText,jpegInfo,esc,fit,pack,fmtTime,APP_VERSION,PW,MG,setS:v=>{S=v;},getS:()=>S};\n');
const M = require(modPath);

/* ---------- 2. fixture state ---------- */
const jpg = fs.readFileSync(path.join(__dirname, 'fixture.jpg'));
const photo = () => new Blob([jpg], { type: 'image/jpeg' });

const logs = [];
const t0 = new Date('2026-08-26T09:12:00');
const at = i => new Date(t0.getTime() + i * 90000).toISOString();
for (let i = 1; i <= 22; i++) logs.push({ n: i, ok: true, at: at(i) });
logs.push({
  n: 23, ok: false, at: at(23),
  defects: ['Sweep out of limit', 'Oversize branch / knot'],
  meas: 'sweep 62 mm/m', spec: 'max 40 mm/m',
  note: 'Mid-stem sweep on butt log. Operator cutting through the bend rather than docking at the change of direction. Raised with the processor operator on site; long note included here deliberately so the test exercises text wrapping and page breaking.',
  photos: [photo(), photo(), photo()]
});
logs.push({ n: 24, ok: false, at: at(24), defects: ['SED under spec'], meas: 'SED 11.8 cm', spec: 'min 14 cm', note: '', photos: [photo()] });
logs.push({ n: 25, ok: false, defects: ['Poor docking / ragged end', 'Excess bark'], meas: '', spec: '', note: 'Ragged docking on three consecutive stems.', photos: [] });
// many defects + iOS smart punctuation: exercises wrapping and WinAnsi mapping
logs.push({
  n: 26, ok: false, at: at(26),
  defects: ['Sweep out of limit', 'Crook / kink', 'Ramicorn / double leader', 'Fluting', 'Spiral grain',
            'Harvester head damage', 'Bark stripping', 'Mud / stone / foreign matter'],
  meas: 'sweep 55\u201360 mm/m', spec: 'max 40 mm/m',
  note: 'Operator\u2019s head pressure too high \u2014 \u201cfeed rollers\u201d slipping\u2026',
  photos: [photo()]
});

const STATE = {
  date: '2026-08-26',
  place: 'Test compartment, main landing beside the test track',
  assessor: 'Test Assessor',
  crew: 'Test Crew — harvester and processor, night shift relief crew under supervisor on loan from the northern block',
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

check('esc maps iOS smart punctuation to WinAnsi',
  M.esc('\u2019\u2018\u201c\u201d\u2013\u2014\u2026') === '\x92\x91\x93\x94\x96\x97\x85', JSON.stringify(M.esc('\u2019\u2014')));
check('esc escapes PDF delimiters', M.esc('a(b)c\\') === 'a\\(b\\)c\\\\');
check('esc replaces unmappable characters', M.esc('\u{1F332}x') === '?x');
check('fit truncates to width', M.tw(M.fit('x'.repeat(400), 8, false, 100), 8, false) <= 100);
check('fmtTime gives HH:MM', /^\d\d:\d\d$/.test(M.fmtTime(at(1))));

console.log('\nVersioning');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const cacheName = (sw.match(/const CACHE\s*=\s*'([^']+)'/) || [])[1];
check('APP_VERSION matches CACHE in sw.js', cacheName === 'logcheck-' + M.APP_VERSION,
  'index.html ' + M.APP_VERSION + ' vs sw.js ' + cacheName);

console.log('\nPersistence packing');
(() => {
  const st = { logs: [{ n: 1, ok: true }, { n: 2, ok: false, defects: [], photos: [photo(), photo()] }] };
  const stored = new Set();
  const p1 = M.pack(st, stored);
  check('pack replaces Blobs with string keys', p1.session.logs[1].photos.every(k => typeof k === 'string'));
  check('pack returns unsaved photos', p1.fresh.length === 2);
  check('pack leaves in-memory state untouched', st.logs[1].photos.every(b => b instanceof Blob));
  p1.fresh.forEach(([k]) => stored.add(k));
  const p2 = M.pack(st, stored);
  check('pack keys are stable and not re-sent', p2.fresh.length === 0 &&
    p2.session.logs[1].photos.join() === p1.session.logs[1].photos.join());
})();

console.log('\nAggregation');
M.setS(STATE);
const freq = M.freqTable();
const distinct = new Set(logs.filter(l => !l.ok).flatMap(l => l.defects));
check('freqTable counts defects', freq.length === distinct.size, JSON.stringify(freq));
check('freqTable tallies repeats', freq.find(r => r[0] === 'Sweep out of limit')[1] === 2);
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

  // every text run must end inside the right margin (by the same width model used to wrap)
  const runs = [...buf.toString('latin1').matchAll(/\/F([12]) ([\d.]+) Tf ([\d.]+) [\d.]+ Td \(((?:\\.|[^\\)])*)\) Tj/g)];
  const over = runs.filter(r => {
    const txt = r[4].replace(/\\(.)/g, '$1');
    return Number(r[3]) + M.tw(txt, Number(r[2]), r[1] === '2') > M.PW - M.MG + 0.5;
  }).map(r => r[4].slice(0, 40));
  check('no text runs past the right margin', runs.length > 50 && over.length === 0, over.join(' | '));

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
    check('smart punctuation survives into the PDF', txt.includes('Operator\u2019s') && txt.includes('\u2014'));
    check('bracket shows en dash range', txt.includes('14.2 \u2013 31.8 cm'));
    check('check times appear', txt.includes('Time checked'));
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
