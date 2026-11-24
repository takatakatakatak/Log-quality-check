# CLAUDE.md — working notes for this repository

Read this before changing anything. It records *why* the code is shaped the way it
is. Most of the constraints below look arbitrary until you know the deployment
context, and several of them have no error message when you violate them — things
just silently stop working on the phone, in the bush, three hours from the office.

## What this is

A field tool for recording log quality checks on a harvesting landing. It is used
on **company-issued iPhones that are fully locked down by MDM** — no App Store, no
sideloading, no certificate exceptions, ever. The only software surface available
is mobile Safari. That single fact drives every decision in this repo.

The user is a harvesting forester standing on a cramped landing, often in rain,
often in sun too bright to read a dim screen, frequently wearing gloves, usually
with no mobile reception. He is not a captive audience: if the tool is slower than
a notebook, he will use a notebook.

## The hard constraints (violating these breaks the product)

**1. Zero runtime dependencies. No network requests of any kind after load.**
No CDN, no npm package loaded at runtime, no Google Fonts, no analytics, no API
calls. The PDF writer is hand-rolled inside `index.html` precisely so there is no
`jsPDF` fetch to fail in a dead zone. If you are tempted to `npm install` something,
you are solving the wrong problem. This also matters politically: the entire tool is
auditable by one person reading one file, which is what got it past IT.

**2. Nothing leaves the device.** There is no server, no account, no telemetry, no
upload. GPS fixes and photographs live in the phone's IndexedDB until the user
personally chooses to share a PDF. Do not add a "sync" feature, a crash reporter, or
a remote config. The privacy story is a feature, not an oversight.

**3. It must be served over HTTPS.** Opened from `file://` — an email attachment, a
file in the Files app — iOS Safari silently disables geolocation, the Web Share
API, IndexedDB persistence, and service worker registration. There is no workaround.
GitHub Pages is the current host.

**4. In-spec is one tap.** This is the core interaction and the reason the tool gets
used. The overwhelming majority of logs are in spec. Tapping the green button
increments the tally and does nothing else — no confirmation, no dialogue, no
required field, no undo prompt. Every future feature must leave that path at exactly
one tap. Photographs, defect selection and notes exist only behind the red button.

**5. Bump `CACHE` in `sw.js` on every change to `index.html`, and `APP_VERSION` in
`index.html` with it.** Currently `logcheck-v2` / `'v2'`. The browser only reinstalls
a service worker when `sw.js` changes byte-for-byte; changing `CACHE` is that change,
and the install then re-fetches the whole shell (bypassing the HTTP cache) into a fresh
cache. Without the bump, installed phones keep running the old shell — the single most
common way this class of app goes stale in the field. `APP_VERSION` is only the label
shown in the masthead so you can see which build a phone is running; it plays no part
in fetching, but `test/pdf-smoke.js` fails if it disagrees with `CACHE`, which catches
a half-done bump.

**6. Do not invent grade tolerances.** Sweep limits, minimum SED, length tolerances
and trim allowances vary by customer and by contract. The defect list is deliberately
descriptive, not prescriptive, and the measured/spec fields are free text. If asked
to add automatic pass/fail logic, ask for the actual specification document first.
Guessing a threshold here produces a document that could be quoted back in a dispute.

## Domain notes you will not guess

The measurement method embedded in the UI is not a simplification, it is how the job
is actually done. You cannot calliper length, SED and LED on every log on a working
landing — the stack is tight, the machines are moving, and the operator is waiting.
What a forester does is measure the lengths available, then find the smallest and
largest SED and LED at either end of the stack. If both extremes conform, everything
bracketed between them conforms. That is what the optional "Stack bracket" panel
records, and the PDF states the logic explicitly so a reader understands how 40 logs
were assessed from six measurements. Do not replace it with per-log dimension entry.

**Grade codes** read `species_product_length_SED`, e.g. `S_SL_4.8_16` is species S,
product SL (sawlog), 4.8 m contract length, 16 cm minimum SED. The length is a sale
designation, not the cut length: a 4.8 log is actually docked longer (about 4.95 m in
that example). Never derive a length tolerance from the code. The 62 codes in
`GRADE_CODES` came from roadside stock reports, with only the grade column kept. Field
shorthand drops the species and the underscores: **"S16" means a sawlog with a 16 cm
SED**, so the grade search matches typed letters then numbers, in order, against the
product, length and SED parts first (`gradeRank()`, tier 1).

**The defect schedule** (`DEFECTS`, 51 entries in 7 groups) was consolidated from
the customer log specifications. Each customer names the same defect differently
("log end draw wood", "sawlog end draw wood", "felling drawn wood"); each entry is one
defect in plain landing language. The ply/veneer specs check the most characteristics,
mostly at the log end (out of round, butt flare, angle cut, scarf, sloven, splits, draw
wood, side tear, pith position, brown heart, navel, birds eye), so those are all listed.
Entries carry no limits and no customer names; the test fails if a name contains a
digit. Groups run form → branches & knots → log end → dimension → damage → biological &
condition → presentation, the order a log is usually looked over. Renaming an entry is
safe: saved logs keep their text, and editing an old log shows unlisted names under
"Earlier list". The specification document itself is confidential and must never be
added to this repo.

**No identifying data in this repo.** The repo is public and the tool must not be
traceable to any grower, customer or contractor. Grade codes only: no customer or
contractor codes, compartment names, tonnages, people or real coordinates, including
in test fixtures and placeholders. Source reports must never be committed; keep them
outside the repo or in `.git/info/exclude`. The smoke test fails on a known list of
banned strings.

Vocabulary, so the copy stays credible: **SED** small-end diameter, **LED**
large-end diameter, **docking** cross-cutting to length, **ramicorn** a steeply
angled oversized branch, **fluting** longitudinal stem grooving, **kino** gum vein.
A **landing** (or dump) is where logs are stacked; a **coupe** or **compartment** is
the harvest area. Grades belong to customers, not to the grower.

## Architecture

One file, `index.html`, ~1,000 lines, organised in ten numbered sections. Keep the
numbering and keep it one file — splitting into modules would require either a build
step or additional HTTP requests, and both are net negatives here.

| Section | Contents |
|---|---|
| 1 | PDF writer: `Doc` class, text metrics, JPEG parsing |
| 2 | `DEFECTS` — the defect schedule, grouped; `GRADE_CODES` and the grade search ranking |
| 3 | State shape, IndexedDB persistence, localStorage recall lists |
| 4 | Pane navigation |
| 5 | Geolocation |
| 6 | Log capture, the defect sheet, photo downscaling |
| 7 | Register rendering and the tally |
| 8 | Report view and defect frequency |
| 9 | PDF assembly and delivery (share / save / preview) |
| 10 | Header sync, boot, service worker registration |

Everything above the `@test-extract-end` marker is free of parse-time DOM access, so
`test/pdf-smoke.js` can load it in Node. **Keep it that way** — do not put
`document.getElementById` at the top level above that marker, or the test suite
stops being able to run headless.

### The PDF writer

Emits PDF 1.4 by hand: Helvetica and Helvetica-Bold (base-14, so no font embedding),
rectangles, lines, and baseline JPEG images embedded raw via `/DCTDecode`. Canvas
always produces baseline YCbCr JPEG, which is exactly what `/DCTDecode` with
`/DeviceRGB` expects, so photos are passed through with no re-encoding.

`Doc` API: `text()` flows and wraps with automatic page breaks; `put()` places a
single string at absolute coordinates and does **not** wrap — wrap with `wrapText()`
first or use `text()`; `kv()` draws a label/value row; `head(s, keep)` draws a section
rule and keeps `keep` points of following content on the same page; `rect()`, `line()`, `drawImage()` are absolute. `space(h)` breaks the
page if `h` will not fit. `footers()` runs last, after page count is known.
`build()` assembles objects, computes byte offsets, and writes the xref table.

Character widths are **approximated** by class (narrow / wide / digit / caps /
default) rather than using the real Helvetica metrics table. Line wrapping is
therefore slightly conservative. That is a deliberate trade of ~90 lines of width
table for a small amount of right-margin slack. If text ever overflows the margin,
fix `charW()`, do not add a font library. The smoke test checks every text run in
the generated PDF ends inside the right margin, by this same width model.

Text is encoded as WinAnsi. `esc()` maps the Unicode punctuation iOS types by default
(curly quotes, en/em dashes, ellipsis) to their WinAnsi codes; anything unmappable
becomes `?`.

### State

```js
S = {
  date: 'YYYY-MM-DD', place, assessor, crew, grade,
  gps: { lat, lon, acc, at } | null,
  bracket: { sedmin, sedmax, ledmin, ledmax, lenmin, lenmax },   // strings
  logs: [
    { n, ok: true, at },                       // at: ISO time of the verdict tap
    { n, ok: false, at, defects: [], meas, spec, note, photos: [Blob] }
  ]
}
```

In memory, photos are Blobs. On disk (IndexedDB `logcheck`, version 2), photos live in
their own `photos` store, written once each; the `kv` → `session` record holds their
string keys instead (`pack()` does the swap). That way an in-spec tap rewrites a few KB,
not every photo taken so far. Logs saved by v1 with Blobs inline still load and are
migrated on the next save; unreferenced photos are pruned at boot and on clear.
Blobs rather than data URIs because data URIs are ~33% larger.

Saves are debounced 250 ms and flushed immediately on `visibilitychange`/`pagehide`,
because iOS can suspend a backgrounded web app without warning. `localStorage` holds
only the small recall lists for assessor / crew / grade, updated when a header field
changes.

Photos are downscaled to a 1400 px long edge at JPEG quality 0.72 on capture, taking
a 12 MP iPhone photo to roughly 150 KB. Do not raise this without checking the
resulting PDF still attaches to an email comfortably.

### Delivery

`navigator.share({ files: [pdf] })` is the primary path — it opens the iOS share
sheet, from which Mail attaches the PDF as a real attachment. This is the whole
reason the tool works. **`mailto:` cannot carry attachments**; that is a protocol
limitation, not a browser one, so do not "simplify" the share path to a mailto link.
Fallbacks are a blob download to Files, and an in-browser preview.

## Field-legibility rules for any UI change

Sunlight readability and gloved operation, not aesthetics, decide this UI.

- Minimum 17 px body text; no font weight below 500 on a light background.
- Verdict buttons stay at least 56 px tall and stay pinned to the bottom of the
  viewport within thumb reach, respecting `env(safe-area-inset-bottom)`.
- Light background, near-black text. Dark mode was considered and rejected: it is
  worse in direct sun, which is the dominant condition.
- Green means conforming, red means defect, consistently, everywhere, including in
  the PDF. Those are marking-paint colours and they are already the site vocabulary.
- Never rely on colour alone — the register also uses position and a left border,
  and every state has a text label.

## Testing

```bash
node test/pdf-smoke.js          # extracts the PDF writer, builds a report, asserts structure
node test/pdf-smoke.js --keep   # leaves test/out/extract.js for inspection
```

Validates the PDF header, trailer, xref offsets against actual object positions, and
image embedding. If `qpdf`, `pdftotext` or `pdftoppm` are installed it additionally
runs a full syntax check, greps the text layer, and renders pages to PNG in
`test/out/` so you can look at the layout. Those three are optional and skipped
cleanly when absent.

**Run this after any change to section 1 or section 9.** A malformed xref offset
produces a file that some readers open and others reject, and you will not notice in
a browser preview.

What the test cannot cover, and what therefore needs a real iPhone before release:
the geolocation permission prompt, the camera sheet, Add to Home Screen, service
worker installation, and the share-sheet handoff to Mail.

## Roadmap

**Grade/tolerance matrix.** The intended next feature. `grade` is already a
type-to-search picker over `GRADE_CODES`; the next step is a table keyed by code, so
that selecting one loads its tolerances so a
measured value can be checked against spec at entry. Sketch of the shape, kept
inline in `index.html` for the same no-dependencies reason:

```js
const GRADES = {
  "S_SL_4.8_16": {
    customer: "…",
    length_m:   { nominal: 5.5, min: 5.5,  max: 5.6 },
    sed_cm:     { min: 14 },
    led_cm:     { max: 45 },
    sweep_mm_per_m: { max: 40 },
    branch_mm:  { max: 60 }
  }
};
```

Wait for the real specification document before implementing. See constraint 6.

## Update notice (done)

When a new worker takes over an already-controlled page, the masthead label turns into
a green "Update ready · tap to restart" button. It never interrupts: tapping it saves,
reloads, and resumes the assessment without the resume prompt (a `sessionStorage`
flag). It is ignored while the defect sheet is open. Untapped, the new shell simply
appears on next launch.

## Register interaction rules

- Finishing: once at least one log exists, a "Finish & report" button (with the log
  count) appears pinned above the verdict buttons. It goes above them, never between
  or beside them, so the In spec / Out of spec row keeps its size and place under the
  thumb. A mis-tap only changes screen; the Report screen opens with "Back to checking".
  The bar's height changes when Finish appears, so `padForBar()` resizes the page's
  bottom padding to keep the last register entry reachable.

- Delete takes two taps: the first arms the × as "Delete?" for three seconds.
- Tapping an out-of-spec entry reopens it in the defect sheet on a copy; Cancel
  discards edits. In-spec entries are not editable — delete and re-tap instead.
- Each verdict flashes the tally drum (green / red), because iOS Safari ignores
  `navigator.vibrate`. Buttons use `touch-action: manipulation` so quick taps are
  counted, not treated as a double-tap zoom.
- A GPS fix is taken automatically at boot only when location permission is already
  `granted`; the permission prompt itself stays behind the Get fix button.

## iOS keyboard and fixed layers

iOS Safari can draw a focused field's text in the wrong place — it appears to jump out
of the box — when the field sits inside a `position:fixed` layer and the page beneath
scrolls while the keyboard opens. The defect sheet is exactly that, so:

- While the sheet is open the page is pinned (`showSheet()` sets `body` to
  `position:fixed` at the current offset and restores the scroll on close).
- The sheet is sized to `visualViewport` (the area above the keyboard) by `fitSheet()`,
  so iOS never needs to scroll the page to reveal the field being typed in; the focused
  field is centred within the sheet once the keyboard is up.
- No `-webkit-overflow-scrolling: touch` anywhere: it is obsolete since iOS 13 and is
  known to detach text and caret rendering from their inputs.
- No smooth programmatic scrolling while a field is focused and the keyboard is
  animating; scroll instantly, after it has opened.

Always open and close the sheet through `showSheet()`. This cannot be reproduced in
desktop browsers; check it on an iPhone.

## Things deliberately not done

- No cloud sync, no accounts, no multi-user. Adds a privacy review and an outage mode.
- No CSV or JSON export yet. Nobody has asked; the PDF is the deliverable.
- No dark mode. See the legibility rules above.
- No framework. React would add a build step and a bundle for a five-screen form.
