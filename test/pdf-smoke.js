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
fs.writeFileSync(modPath, js + '\nmodule.exports={Doc,buildPdf,freqTable,fileName,tw,wrapText,jpegInfo,esc,fit,pack,fmtTime,APP_VERSION,GRADE_CODES,DEFECTS,searchGrades,canonGrade,PW,MG,setS:v=>{S=v;},getS:()=>S};\n');
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
  defects: ['Sweep', 'Oversize branch / knot'],
  meas: 'sweep 62 mm/m', spec: 'max 40 mm/m',
  note: 'Mid-stem sweep on butt log. Operator cutting through the bend rather than docking at the change of direction. Raised with the processor operator on site; long note included here deliberately so the test exercises text wrapping and page breaking.',
  photos: [photo(), photo(), photo()]
});
logs.push({ n: 24, ok: false, at: at(24), defects: ['SED under spec'], meas: 'SED 11.8 cm', spec: 'min 14 cm', note: '', photos: [photo()] });
logs.push({ n: 25, ok: false, defects: ['Sloven', 'Excess bark / not debarked'], meas: '', spec: '', note: 'Ragged docking on three consecutive stems.', photos: [] });
// many defects + iOS smart punctuation: exercises wrapping and WinAnsi mapping
logs.push({
  n: 26, ok: false, at: at(26),
  defects: ['Sweep', 'Kink / crook', 'Fork / double leader / ramicorn', 'Fluting', 'Spiral grain',
            'Harvester / machine damage', 'Draw wood', 'Foreign matter (metal, stone, mud)'],
  meas: 'sweep 55\u201360 mm/m', spec: 'max 40 mm/m',
  note: 'Operator\u2019s head pressure too high \u2014 \u201cfeed rollers\u201d slipping\u2026',
  photos: [photo()]
});

const STATE = {
  date: '2026-08-26',
  // Synthetic values only. The coordinates are open ocean on purpose.
  place: 'Test compartment, main landing beside the test track',
  assessor: 'Test Assessor',
  crew: 'Test Crew — harvester and processor, a deliberately long crew description so the footer must truncate',
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

console.log('\nDefect schedule');
const allDefects = M.DEFECTS.flatMap(g => g[1]);
check('defect names are unique', new Set(allDefects).size === allDefects.length, allDefects.length + ' entries');
check('defect groups are non-empty', M.DEFECTS.every(g => g[0] && g[1].length));
check('defect names carry no limits (no digits)', allDefects.every(d => !/\d/.test(d)), allDefects.filter(d => /\d/.test(d)).join());
check('defect names fit one chip line', allDefects.every(d => d.length <= 36), allDefects.filter(d => d.length > 36).join());

console.log('\nGrade search');
const G = q => M.searchGrades(q, []);
const sawlog16 = ['A_SL_4.8_16', 'A_SL_4.9_16', 'A_SL_5.4_16', 'S_SL_4.7_16', 'S_SL_4.8_16', 'S_SL_5.0_16', 'S_SL_5.6_16'];
check('62 grade codes, no duplicates', M.GRADE_CODES.length === 62 && new Set(M.GRADE_CODES).size === 62);
check('every code is species_product_length_SED', M.GRADE_CODES.every(c => /^[A-Z]+_[A-Z]+_\d+\.\d_\d+$/.test(c)));
check('"S16" finds sawlogs with 16 cm SED', JSON.stringify(G('S16').sort()) === JSON.stringify(sawlog16), G('S16').join());
check('search ignores case and spaces', G('s 16').join() === G('S16').join());
check('"PW5" finds pulpwood 5 cm SED', G('PW5').join() === 'A_PW_0.0_5,S_PW_0.0_5,S_PW_4.8_5', G('PW5').join());
check('"S30" ranks sawlogs above other S grades', G('S30').slice(0, 8).every(c => c.includes('_SL_')), G('S30').join());
check('full code typed in lower case matches exactly', G('s_sl_4.8_16')[0] === 'S_SL_4.8_16');
check('unknown grade returns nothing (typed value used as is)', G('S99').length === 0);
check('remembered hand-typed grades are searchable', M.searchGrades('X9', ['XX_9_TEST'])[0] === 'XX_9_TEST');
check('canonGrade normalises listed codes only', M.canonGrade(' s_sl_4.8_16 ') === 'S_SL_4.8_16' && M.canonGrade('custom 9') === 'custom 9');

console.log('\nNo identifying data');
// SHA-256 (first 16 hex) of lower-case words that must never appear in this public repo:
// organisation, customer and contractor codes, compartment names and real coordinates.
// Hashed so this file doesn't itself contain them. Words are runs of [a-z0-9.].
const BANNED = new Set([
  '01e76a28977874f8', '02de500142704ded', '03d21914b29cf0da', '056c14b618331e9e',
  '074af2bf8e848549', '0a52c5a6abc80f87', '0b13f2d7e8f91660', '0d2690431235a135',
  '11a94fd25a7205d8', '1372c63b35ea72a5', '1847ec1b65381071', '18c33592ef0c5fc3',
  '1a2180aa26f3f33e', '1b611f3954cb3242', '1be9291713c761cd', '1e51850da91ff6e1',
  '1ee123350d630932', '213d21c0e4f00b53', '221f5bcaa2fa7395', '22ab58dc1441e585',
  '23670cabf30801a3', '23facaae57613a2b', '284db3027411f2e2', '2886b0b748b7eddb',
  '2cc2c1bbe4b390d6', '2cee7a6a6380a48f', '37ecaf2d12462978', '38bbc2ef4cbcf828',
  '3b3516aad1d9e72e', '4230fe76f6f5c455', '426d72415baa9710', '4462bce6b4c03fef',
  '47f134b133960371', '4af20f0ac7c26fc8', '4ca6f6d5a544bf57', '4ccc66522952fe66',
  '4d50e62220103047', '4e2b8ac667adebbd', '4efeb9b31f09934f', '4f59e0109153a5de',
  '540cb2d1a1eaef2c', '555b3d8aaac00cb4', '568545cf69c679f2', '5ac9b977aa1d71c0',
  '5bae752e0c9c8ed0', '61fee9f2287b264c', '66f5060e75d26f80', '6960b9fcfc508bb4',
  '69cf401e9cb9c2b1', '6d69f1fd4bc77509', '6d8b6fd96b57c7b2', '73659cadfde8431b',
  '7573255a5e3e2ca1', '7575e4ca4e6a03f8', '790abdb3a19ec519', '7a5f9aacea246d88',
  '7ac7027b6c9520f9', '7e97092758573a9c', '801648462211179c', '81df37f9f69927c0',
  '825155b2dc15f91a', '861ba9d179ff63fe', '9058aa3ff37e12d0', '913e4a09b69b9d54',
  '949029fa12cbcd29', '97864e878fe129a3', '97fe8a3749069931', '98c0f87ec38b0c86',
  '9b06f24716e0c579', 'a15d79acdc8a0e23', 'a1a02b3b16e471e0', 'a7fc711b60212a05',
  'b7c992207b80abff', 'b81d19db3f57e517', 'bbc5a271d4862a55', 'bc6d872285833b16',
  'bf446ea38129b6f1', 'c2e2ca35f4d78918', 'c5643f32bf61b942', 'c5fd2a9fa62e9a37',
  'cc6e11391c066f2a', 'ceb00a91525da64f', 'd044aa6a8efd0530', 'd5391b2f42d7a284',
  'da5b368ed2efd7af', 'dac7ec14001a271e', 'dbdb0e9550c302db', 'dc90dbda1881aa85',
  'dcec10fb38d70262', 'de23bcd0f2e97ddf', 'dfbfcd6f5474f6d4', 'e5817865c7156c3f',
  'e8422bc48257faa2', 'ed2abfda9d7e2148', 'ef9e07fed52a6b5e', 'f4f43646d9a65bc9',
  'f85fed389745c61b', 'fb9ca2061cd722d2'
]);
const sha = w => require('crypto').createHash('sha256').update(w).digest('hex').slice(0, 16);
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n')
  .filter(f => f && !/\.(png|jpg)$/.test(f));
const hits = tracked.filter(f => (fs.readFileSync(path.join(ROOT, f), 'utf8').toLowerCase().match(/[a-z0-9.]+/g) || [])
  .some(w => BANNED.has(sha(w))));
check('no identifying names, codes or coordinates in tracked files', hits.length === 0, hits.join(', '));

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
check('freqTable tallies repeats', freq.find(r => r[0] === 'Sweep')[1] === 2);
check('fixture defects all come from the schedule', logs.filter(l => !l.ok).every(l => l.defects.every(d => allDefects.includes(d))));
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
    check('grade appears in text layer', txt.includes('S_SL_4.8_16'));
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
