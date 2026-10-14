# STS//LAB — Sit-to-Stand Biomechanics Lab

A standalone, static web app that runs the **CDC STEADI 30-Second Chair Stand** test using
in-browser computer vision (MediaPipe Pose Landmarker). TRON-styled neon HUD. No framework,
no build step, no npm runtime dependencies — just open `index.html` over HTTPS.

- **Screen 1 — Entry:** instructions, participant form, language selector (English / 普通话 /
  粤语) with an embedded YouTube demo, then a **PROCEED** button.
- **Screen 2 — Camera:** live pose markers, guided calibration, 3-2-1 countdown, 30-s test with a
  live rep counter, then **COMPLETE TEST**.
- **Screen 3 — Results:** stand count, CDC classification (when valid), biomechanical metrics,
  three charts, per-rep table, QC details, and a one-click ZIP download of all data.

> Not a medical device. Side-on 2D camera angles are approximate; thresholds marked `[TUNE]` in
> `js/config.js` are unvalidated; arm-use detection is heuristic. Research/screening use only.

## Project layout

```
index.html              entry point (loads css/ + js/)
css/styles.css          TRON theme (Orbitron + Rajdhani, neon blue/orange, grid/particles)
js/
  config.js             all analysis parameters (CONFIG)
  schema.js             data schema — single source of truth (SCHEMA)
  analysis.js           offline biomechanics engine (STSAnalysis) — validated, unchanged
  export.js             CSV / ZIP / Google Sheets / local outbox (Exporter)
  charts.js             dependency-free canvas charts (Charts)
  pose-engine.js        MediaPipe + camera + skeleton overlay (PoseEngine)
  app.js                UI controller / screen flow
tests/                  node unit tests for the engine (run.js, synth.js)
tools/build-dictionary.js   regenerates DATA_DICTIONARY.md from schema.js + config.js
apps-script/Code.gs     Google Sheets receiver (for optional cloud upload — not required)
DATA_DICTIONARY.md      generated documentation of every exported field
```

The analysis engine, pose engine, exporter and charts are reused **unchanged** from the validated
reference; the TRON UI (`css/styles.css`, `js/app.js`) is built around them.

## Run it locally

The camera and the YouTube embed require a real origin — they do **not** work from `file://`.
Serve the folder over http(s) with any static server, for example:

```powershell
# Python 3 (built in on many systems)
python -m http.server 8000
# then open http://localhost:8000/
```

```powershell
# or Node, if installed
npx serve .
```

Camera access additionally needs a **secure context**: `http://localhost` is treated as secure, so
local testing works; on any other host use HTTPS (GitHub Pages provides this automatically).

## Run the engine tests

The analysis engine ships with unit tests that check it against synthetic ground-truth data.
They require Node.js (used only as a test runner; the app itself has no Node dependency).

```powershell
node tests/run.js            # all tests must pass
node tools/build-dictionary.js   # regenerate DATA_DICTIONARY.md after any schema/config change
```

If `node` is not found, install Node.js LTS (e.g. `winget install OpenJS.NodeJS.LTS`) and reopen
the terminal.

## Deploy to GitHub Pages

1. Create a repo (e.g. `STS-Lab`) and upload **all files at the repo root** (`index.html` at the top
   level, with `css/` and `js/` beside it).
2. In the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save**.
3. Open `https://<username>.github.io/STS-Lab/` on your phone (HTTPS enables the camera).

## Optional: Google Sheets upload

Cloud upload is **off by default** — results stay on the device and can be downloaded as a ZIP.
To enable it later:

1. In Google Sheets: **Extensions → Apps Script**, paste `apps-script/Code.gs`, then
   **Deploy → New deployment → Web app** (Execute as *Me*, Access *Anyone*).
2. Copy the `/exec` URL into `CONFIG.sheets.webhookUrl` in `js/config.js`.

Payloads are posted as `text/plain` (`{schemaVersion, summary, reps}`), de-duplicated by
`session_id`, with a localStorage outbox that retries when connectivity returns.

## Browser support

Modern Chrome / Edge / Safari (desktop and mobile). First load fetches the MediaPipe runtime and
pose model from a CDN, so an internet connection is needed the first time; the camera stream and
pose inference then run entirely on-device.
