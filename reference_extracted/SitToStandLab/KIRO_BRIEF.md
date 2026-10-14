# KIRO BRIEF — TRON Sit-to-Stand Lab

## A. What to type in Kiro (paste this first, in a new Spec/Vibe session)

> Build a standalone, static web app called "STS//LAB — Sit-to-Stand Biomechanics Lab" using vanilla HTML, CSS and JavaScript only (no framework, no build step, no npm dependencies), deployable on GitHub Pages from the repo root. Follow the attached KIRO_BRIEF.md exactly: TRON-style neon orange/blue aesthetic with the Orbitron font; entry screen with instructions and a language selector (English / Mandarin / Cantonese) that plays an embedded YouTube Shorts demo with a PROCEED button; a camera page using MediaPipe Pose Landmarker (in-browser) with visible pose markers that counts sit-to-stand reps in the CDC 30-Second Chair Stand test; a COMPLETE TEST button that leads to a results page with the count and a biomechanical analysis; a stub for later Google Sheets upload. Generate requirements.md, design.md and tasks.md first, then implement task by task. Reference code (config.js, schema.js, analysis.js and tests) is provided in /reference — reuse analysis.js unchanged and run its tests.

Then attach/copy the `reference/` folder (files from the zip I gave you: `config.js`, `schema.js`, `analysis.js`, `export.js`, `charts.js`, `pose-engine.js`, `tests/`, `DATA_DICTIONARY.md`) into the Kiro workspace. These already contain a tested analysis engine, so Kiro only needs to build the UI around it.

---

## B. Product requirements

**B1. Hosting / tech**
- Pure static site: `index.html`, `css/`, `js/`, no server. Works on GitHub Pages (HTTPS, so camera works). Relative paths only.
- MediaPipe Tasks-Vision v0.10.18 loaded from jsDelivr (`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs`, wasm `.../wasm`), model `pose_landmarker_full.task` from `storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/`. GPU delegate with CPU fallback.
- Google Fonts: Orbitron (headings, numbers, buttons), plus a readable secondary (Rajdhani or Exo 2) for body text.
- Mobile-first and tablet/desktop responsive; works in portrait and landscape; no horizontal scroll.

**B2. Visual style — TRON**
- Near-black navy background (#05070d → #0a1020) with an animated tech backdrop: perspective grid floor, faint circuit/hex pattern, slow drifting particles or scanlines (canvas or CSS; keep ≤ 5 % CPU; disable during the live test so it does not steal frames from pose detection).
- Two neon accents: **electric blue #00d4ff** (primary, data, skeleton near side) and **neon orange #ff6a00** (calls to action, alerts, counters). Glow via `text-shadow`/`box-shadow`/`drop-shadow`, thin 1–2 px glowing borders, angled/clipped corners on panels (`clip-path`), HUD-style corner brackets.
- Buttons: outlined neon, uppercase Orbitron, hover/active glow pulse. PROCEED / COMPLETE TEST are orange; secondary actions blue.
- Respect `prefers-reduced-motion`. Minimum contrast: body text ≥ 4.5:1.

**B3. Screen 1 — Entry / instructions**
- Title "STS//LAB", subtitle "30-Second Chair Stand · Computer-Vision Assessment".
- Short instruction panel (numbered, icon per step):
  1. Use a firm 17-inch (43 cm) chair against a wall.
  2. Place the device 2–3 m away, at hip height, **side-on** so your whole body is in frame.
  3. Wear fitted clothing; ensure good lighting.
  4. Sit, feet flat, **arms crossed on your chest**.
  5. On GO, stand fully and sit again as many times as you can in 30 seconds.
- Participant fields: ID (pseudonymous), age, sex, height (cm), body mass (kg, optional), site, notes; consent checkbox.
- **Language selector**: three large neon buttons — ENGLISH · MANDARIN (普通话) · CANTONESE (粤语). Clicking one opens the video panel (modal or inline) and plays that language's video:
  - English: https://www.youtube.com/shorts/rShcj4ro6fc  → video ID `rShcj4ro6fc`
  - Mandarin: https://www.youtube.com/shorts/x6Abz7Gzw6U → `x6Abz7Gzw6U`
  - Cantonese: https://www.youtube.com/shorts/973w63PEblg → `973w63PEblg`
- **Embedding requirement:** these are YouTube Shorts; embed with the standard embed URL, **not** the shorts URL:
  `<iframe src="https://www.youtube.com/embed/{ID}?autoplay=1&rel=0&playsinline=1&modestbranding=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin">`
  Use a vertical 9:16 container (max-height ~70vh). Autoplay with sound requires a user gesture, which the language button click provides. Must be served over http(s) (not `file://`). Add a visible fallback link "Open on YouTube" under the player in case embedding is blocked, and a way to switch language without leaving the panel.
- Directly beneath the video: orange **PROCEED** button → camera page. (Enable it after the participant form validates; the video need not be fully watched, but PROCEED is only shown once a video has been opened.)

**B4. Screen 2 — CV camera page**
- Request camera (rear camera default on mobile, with front/rear toggle). Show permission-denied help text.
- Full-screen video with canvas overlay drawing **visible pose markers**: skeleton lines (blue near side, dim far side) and glowing joint dots for the 17 tracked landmarks (nose, shoulders, elbows, wrists, hips, knees, ankles, heels, foot-index; indexes 0, 11–16, 23–32). Hollow orange dot when MediaPipe visibility < 0.5. Toggle for labels and for all 33 points. Live knee/hip/trunk angle callouts. Mirror correctly for front camera.
- Guided steps with HUD prompts: position check (whole body, side-on) → stand-tall calibration (2 s still) → sit calibration (2 s still) → 3-2-1 countdown with beeps → 30-s test with large timer and live rep counter (orange) → time up.
- Live counter is for feedback only; the offline analysis is authoritative.
- **COMPLETE TEST** button (orange) appears when the 30 s ends (and an "Stop early" secondary during the test). Pressing COMPLETE TEST runs the analysis and opens the results page.

**B5. Screen 3 — Results**
- Big neon count (stands), classification vs CDC STEADI norms (age/sex) only if QC passes, QC badge and plain-language flag explanations.
- Metric cards: cycle time (mean/SD), ascent/descent time, peak hip velocity, hip rise, peak knee/hip/trunk angles and ROM, trunk lean, fatigue slope, first-vs-last-third change.
- Three charts (progress, knee/hip/trunk angles, hip velocity) in neon blue/orange; per-rep table; collapsible QC details.
- Actions: Download results (ZIP: summary, reps, analysed frames, raw frames, session JSON), Test again (same participant), New participant, Home.
- **Google Sheets (later):** build a `sendToSheets(payload)` function and `CONFIG.sheets.webhookUrl = ''` now; when empty, show "Cloud upload not configured — results saved locally". Payload = `{schemaVersion, summary, reps}` JSON posted as `text/plain`. Keep a localStorage outbox for retry. Dedupe by `session_id`. (Apps Script receiver is in `reference/apps-script/Code.gs` for when we wire this up.)

**B6. Analysis (use the supplied engine)**
`reference/analysis.js` exposes `STSAnalysis.analyzeSession({recording, calib, participant, meta, cfg, schema})` and `buildCalibration/checkCalibration`. Reuse it unchanged: zero-lag Butterworth filter at 6 Hz, 30 Hz resample, px→m scaling from height, hip-progress state machine, CDC half-way rule, arm-use heuristic, QC flags. Do not re-implement or simplify it. Run `node tests/run.js` — all tests must pass.

**B7. Data dictionary**
`reference/DATA_DICTIONARY.md` is generated by `node tools/build-dictionary.js` from `schema.js` + `config.js`. Keep that pipeline so any added field is documented.

## C. Acceptance criteria
1. Opens on GitHub Pages with no console errors; fonts and tech background render.
2. Each language button plays the correct YouTube video inline (verify all three on mobile Safari/Chrome and desktop).
3. PROCEED reaches the camera page; markers visible and tracking at ≥ 15 fps on a mid-range phone.
4. A full 30-s test yields a count within ±1 of a manual count on a pilot video.
5. COMPLETE TEST → results page with count, metrics, charts, QC; ZIP download works.
6. Works offline-safe: no crash if Sheets URL empty or network down.
7. Lighthouse accessibility ≥ 90; reduced-motion respected.

## D. Deploy to GitHub Pages
1. Create repo (e.g. `STS-Lab`), upload all files at repo root (`index.html` at top level).
2. Settings → Pages → Source: Deploy from branch → `main` / root → Save.
3. Open `https://<username>.github.io/STS-Lab/` on the phone.

## E. Known limits (keep visible in the UI footer)
Side-on 2D camera angles are approximate; thresholds marked [TUNE] in config.js are unvalidated; arm-use detection is heuristic. Research use — not a diagnostic device.
