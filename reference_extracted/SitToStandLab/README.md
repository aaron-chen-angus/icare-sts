# Sit-to-Stand Biomechanics Lab

Browser-only 30-Second Chair Stand (CDC STEADI) with in-browser MediaPipe pose tracking, a calibrated biomechanical analysis (timing, hip kinematics, knee/hip/trunk angles, fatigue, QC flags) and optional live upload to Google Sheets. Vanilla HTML/CSS/JS — no build step.

## Run
- Local: `python -m http.server 8000` in this folder, open `http://localhost:8000` (camera needs HTTPS or localhost).
- Deploy: push the folder to a GitHub repo → Settings → Pages → deploy from branch root.

## Google Sheets
1. New Google Sheet → Extensions → Apps Script → paste `apps-script/Code.gs`.
2. Deploy → New deployment → Web app → Execute as **Me**, access **Anyone** → copy the `/exec` URL.
3. Paste it into `CONFIG.sheets.webhookUrl` in `config.js` (left blank deliberately; do not reuse the SilverHYROX URL).
4. Tabs `Sessions`, `Reps` (and `Frames` if `uploadFrames: true`) are created automatically; columns map by name; duplicate `session_id`s are ignored. Failed uploads queue locally and can be retried from History.

When a webhook is set the setup screen requires a consent tick. Use pseudonymous participant IDs only.

## Test protocol (what the app walks the operator through)
Side-on camera at hip height ~2–3 m away, whole body in frame, 17 in (43.2 cm) chair against a wall, arms crossed on chest, feet flat. Stand tall (2 s) → sit (2 s) → 3-2-1 → 30 s test.

## Outputs
Per test: `summary.csv`, `reps.csv`, `frames_analysis.csv` (30 Hz), `frames_raw.csv` (all landmarks), `session.json` (incl. calibration and parameter snapshot) in one ZIP. Every field is defined in **DATA_DICTIONARY.md** (generated from `schema.js` + `config.js`: `node tools/build-dictionary.js`).

## Verify
`node tests/run.js` — synthetic-body ground-truth tests (count, cycle time, peak velocity, trunk angle, half-rule, arm use, gaps, partial stands, low fps, filter).

## Limitations / before clinical use
- Thresholds marked `[TUNE]` in `config.js` are unvalidated. Run a concurrent-validity study (manual/video count; ideally optical mocap for angles) and tune.
- 2D sagittal angles depend on camera alignment; hip landmark is a pelvis proxy; no left/right symmetry; arm-use detection is heuristic; work-rate is a proxy.
- The live camera/MediaPipe path has not been exercised in an automated test; do a pilot on your target devices.
