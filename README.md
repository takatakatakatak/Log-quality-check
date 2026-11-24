# Log Quality Check

A field tool for recording log quality checks on a harvesting landing, built to run
on locked-down company iPhones where no app can be installed.

Works offline. Nothing is uploaded. Produces a PDF you can attach straight to an
email from the phone.

- Automatic date and GPS fix, with a manual location description
- Assessor, crew/operation and log grade, with recall of previous entries
- Optional stack bracket: min/max SED, LED and length
- One tap per in-spec log; defects, measurements, notes and photos behind one button
- PDF report with summary, defect frequency, an out-of-spec register and a photo appendix

## Files

```
index.html        the entire application — no build step, no dependencies
sw.js             service worker; caches the shell for offline launch
manifest.json     name, colours, standalone display
icon-180.png      iOS home screen icon
icon-192.png      manifest icon
icon-512.png      manifest icon
test/             headless PDF smoke test (Node, no dependencies)
CLAUDE.md         design constraints and rationale — read before changing anything
```

## Deploying

Any static HTTPS host works. HTTPS is not optional: over `file://` or plain HTTP,
Safari disables geolocation, the share sheet, and offline caching.

**GitHub Pages**

1. Push these files to the repository root on `main`.
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Wait for the build, then open the `https://<user>.github.io/<repo>/` URL.

**Cloudflare Pages** — create a project, upload the folder, done. No build command,
no output directory.

## Installing on a phone

1. Open the URL in **Safari** (not Chrome — the share sheet path needs Safari).
2. Share → **Add to Home Screen**.
3. Launch it once while still on reception. The version label in the header changes
   to *offline ready* when the shell has cached.

Adding to the home screen also exempts the app from Safari's seven-day storage
eviction, so an in-progress assessment survives.

If IT will not allow ad-hoc home screen additions, they can push the same URL as a
**Web Clip** in an MDM configuration profile. That is a profile payload, not an app
installation, and is a considerably easier approval than app certification.

## Using it

**1 · Setup** — set the date, tap *Get fix* for coordinates (once location is
allowed, later assessments take the fix automatically), fill in assessor, crew
and grade. Record the stack bracket if you are using the bracketing method.

**2 · Check** — tap **In spec** or **Out of spec** for each log. In spec is one tap.
Out of spec opens the defect sheet: pick defects, optionally record measured against
spec, add a note, take photos. Tap an out-of-spec entry in the register to edit it.
To delete a log, tap × and then *Delete?* within three seconds. Each log records the
time it was checked.

**3 · Report** — review the summary and defect frequency, then *Create PDF and send*
to hand the PDF to the iOS share sheet. Choose Mail and it arrives as an attachment;
you pick the recipient. *Save PDF to Files* and *Preview* are there as fallbacks.

Work autosaves continuously. If the app is closed mid-assessment it offers to resume
on next launch.

## Updating

After editing `index.html`, bump the cache version in `sw.js` and the matching label
in `index.html`:

```js
const CACHE = 'logcheck-v3';   // sw.js        (was v2)
const APP_VERSION = 'v3';      // index.html   (was v2)
```

Phones already carrying the old shell will keep serving it until `sw.js` changes. The
test fails if the two disagree. Once a phone with reception picks up the new version,
its header shows *Update ready · tap to restart*; tapping it reloads straight back into
the assessment in progress.

## Testing

```bash
node test/pdf-smoke.js
```

No dependencies; Node 18+. Builds a report from fixture data and asserts the PDF
structure, including that every xref offset resolves to its object. If `qpdf` and
poppler-utils are installed it also runs a full syntax check and renders pages to
`test/out/*.png` for visual inspection.

## Privacy

There is no server. No account, no telemetry, no analytics, no third-party requests.
GPS fixes and photographs are held in the phone's own storage and go nowhere until
you choose to share a PDF. Clearing an assessment deletes it permanently.

## Browser support

Built and tested for Safari on iOS. Requires: `navigator.geolocation`, the
`capture` file input attribute, IndexedDB, Canvas `toBlob`, and Web Share Level 2
(`navigator.share` with files) for the email path. Safari 15+ covers all of these.
Other modern browsers run the app; the share-to-Mail path may fall back to a
download depending on platform support.
