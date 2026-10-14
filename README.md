# STS//LAB — Sit-to-Stand Biomechanics Lab

**A browser-based computer-vision implementation of the 30-Second Chair Stand Test (30STS).**

| | |
|---|---|
| **Live app** | https://aaron-chen-angus.github.io/icare-sts/ |
| **Source repository** | https://github.com/aaron-chen-angus/icare-sts |
| **App / analysis / schema version** | 1.0.0 / 1.0.0 / 1.0 |
| **Test protocol** | CDC STEADI 30-Second Chair Stand (Jones, Rikli & Beam, 1999) |
| **Pose estimation** | Google MediaPipe Pose Landmarker (BlazePose GHUM), on-device |
| **Status** | Research / screening instrument — **not a medical device** |

> **Clinical disclaimer.** This application is a research and educational tool. It produces
> camera-based estimates, not a clinical diagnosis. Angle and distance metrics are 2-D
> sagittal-plane approximations; several thresholds are engineering defaults pending formal
> validation (marked `[TUNE]` in `js/config.js`). Do not use the output as the sole basis for
> any clinical, rehabilitation, or medical decision.

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [Deploying to GitHub Pages](#2-deploying-to-github-pages)
3. [Google Sheets integration (step by step)](#3-google-sheets-integration-step-by-step)
4. [Complete list of inputs and metrics](#4-complete-list-of-inputs-and-metrics)
5. [Scientific manual: the Sit-to-Stand test](#5-scientific-manual-the-sit-to-stand-test)
6. [Biomechanics of the sit-to-stand movement](#6-biomechanics-of-the-sit-to-stand-movement)
7. [Computer-vision & signal-processing methods](#7-computer-vision--signal-processing-methods)
8. [How each metric is computed](#8-how-each-metric-is-computed)
9. [Quality control and validity](#9-quality-control-and-validity)
10. [Normative data and interpretation](#10-normative-data-and-interpretation)
11. [Limitations](#11-limitations)
12. [Project structure & developer notes](#12-project-structure--developer-notes)
13. [References](#13-references-apa-7th-edition)

---

## 1. Quick start

The app is a pure static site (vanilla HTML/CSS/JS, no build step). It needs a real web origin —
the camera and the embedded demo videos do **not** work from a `file://` path.

**Use the hosted version:** open https://aaron-chen-angus.github.io/icare-sts/ on a phone or
tablet (served over HTTPS, which the camera requires).

**Run locally for development:**

```powershell
# from the project folder — any static server works
python -m http.server 8000
# then open http://localhost:8000/   (localhost counts as a secure context, so the camera works)
```

**Workflow in the app:**

1. **Entry screen** — fill in the participant form, tick the two protocol checkboxes, pick a
   language, and watch the demo. Press **PROCEED**.
2. **Camera screen** — frame the participant **side-on**, whole body in view. Press **START TEST**.
3. **Test** — a 3-2-1 countdown, then 30 seconds of stand/sit repetitions with a live counter.
4. **Results** — the stand count, biomechanical metrics, charts, quality-control flags, and a
   one-click ZIP of all data. Optionally upload to Google Sheets (see §3).

Calibration is **automatic**: the app derives the seated and standing hip reference from the
motion recorded during the test itself (the lowest and highest hip positions), scaled to metres
using the participant's entered height. No "hold still" step is required.

---

## 2. Deploying to GitHub Pages

1. Create a public GitHub repository (this project uses `icare-sts`).
2. Upload all files **at the repository root** — `index.html` at the top level, with `css/` and
   `js/` beside it. (A `.gitignore` already excludes the reference zip and working files.)
3. In the repository: **Settings → Pages → Build and deployment → Source → Deploy from a branch**,
   choose **`main`** and **`/ (root)`**, then **Save**.
4. After ~1 minute the site is live at `https://<username>.github.io/<repo>/` — here,
   https://aaron-chen-angus.github.io/icare-sts/.

To update after changing files, commit and push (or re-upload) the changed files; Pages redeploys
automatically. Hard-refresh on the device to bypass cached CSS/JS.

---

## 3. Google Sheets integration (step by step)

Cloud upload is **off by default** — results stay on the device and can be downloaded as a ZIP.
Enabling it lets each completed test post its summary and per-rep rows to a Google Sheet you
control. Video and raw landmarks are **never** uploaded; only the numeric results are.

### 3.1 What gets sent

A single HTTP `POST` with a JSON body (sent as `text/plain` to keep the request "simple" and avoid
a CORS preflight):

```json
{
  "schemaVersion": "1.0",
  "summary": { "...": "one object — the 93 summary fields" },
  "reps":    [ { "...": "one object per detected repetition (39 fields)" } ]
}
```

Each upload is **de-duplicated by `session_id`**, so re-sending the same test is safe. If the
network is down, the payload is kept in a local **outbox** and retried automatically when the
device comes back online (or manually from the History screen).

### 3.2 Create the Google Sheet and Apps Script receiver

1. Go to <https://sheets.google.com> and create a **new blank spreadsheet**. Name it, e.g.,
   `STS Lab Data`.
2. In that sheet, open **Extensions → Apps Script**. A script editor opens in a new tab.
3. Delete any boilerplate in `Code.gs`, then **paste the entire contents of
   `apps-script/Code.gs`** from this repository. (That script creates `Sessions`, `Reps`, and
   optional `Frames` tabs automatically, matches columns by name, and ignores duplicate
   `session_id`s.)
4. Click the **Save** (disk) icon.

### 3.3 Deploy the script as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Configure:
   - **Description:** `STS Lab receiver` (any text).
   - **Execute as:** **Me** (your Google account).
   - **Who has access:** **Anyone**. *(This is required so the app, running on a different origin,
     can post to it. The URL is an unguessable token; treat it like a secret. Do not post
     identifying data — the app only sends pseudonymous IDs.)*
4. Click **Deploy**. Approve the authorization prompts (choose your account → **Advanced** →
   **Go to … (unsafe)** → **Allow**; this is Google's standard warning for personal scripts).
5. Copy the **Web app URL**. It ends in `/exec` and looks like
   `https://script.google.com/macros/s/XXXXXXXX/exec`.

### 3.4 Wire the URL into the app

1. Open `js/config.js`.
2. Set the webhook URL and (optionally) enable frame upload:

   ```js
   sheets: {
       webhookUrl: 'https://script.google.com/macros/s/XXXXXXXX/exec',
       uploadFrames: false   // true also uploads the ~900-row analysed time series to a "Frames" tab
   },
   ```
3. Commit/push `js/config.js` (or re-upload it) so GitHub Pages serves the updated file.

### 3.5 Verify

1. Open the app, run a test, and on the results screen you should see **"Google Sheets: saved"**
   (or "sent, but the browser cannot confirm receipt (CORS)" — that is normal for `no-cors`
   fallback; the row still arrives). The consent checkbox must be ticked on the entry form for the
   upload to fire.
2. Check the spreadsheet: a **`Sessions`** tab appears with one row, and a **`Reps`** tab with one
   row per repetition.
3. To test the endpoint directly, open the `/exec` URL in a browser — it returns
   `{"status":"active","service":"sts-lab"}`.

### 3.6 Updating the script later

If you add fields to `schema.js`, the receiver appends new columns by name automatically — no
script change needed. If you change the script itself, create a **new deployment version**
(Deploy → Manage deployments → edit → new version), or the old code keeps running.

### 3.7 Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Results say "Cloud upload not configured" | `webhookUrl` is empty — complete §3.4. |
| "sent, but cannot confirm receipt (CORS)" | Expected with the `no-cors` fallback; the row still arrives. De-dup by `session_id` makes re-sends safe. |
| Nothing arrives in the sheet | Re-deploy with **Who has access: Anyone**; confirm the `/exec` URL; check the consent checkbox was ticked. |
| Rows arrive but columns look shifted | You edited the sheet header manually — the script matches by name; restore the original header row or let it recreate on a fresh tab. |
| Authorization error | Re-run **Deploy** and complete the Google OAuth consent for your account. |

---

## 4. Complete list of inputs and metrics

This is the full data model. The authoritative, auto-generated version with every calculation note
is in [`DATA_DICTIONARY.md`](DATA_DICTIONARY.md); the summary below groups it for reading.

### 4.1 Operator inputs (entered on the entry screen)

| Field | Unit | Notes |
|---|---|---|
| **Participant ID** | — | Pseudonymous code. **Never enter real names.** |
| **Age** | years | Used for the STEADI normative lookup (valid 60–94). |
| **Sex** | male / female / other | Used only for the STEADI table (published male/female). |
| **Height (standing)** | cm | **Required and important** — sets the pixel→metre scale. |
| **Body mass** | kg (optional) | Only used for the work-rate proxy. |
| **Chair seat height** | cm | STEADI standard 43.2 cm (17 in). Recorded as a covariate. |
| **Site / session label** | — | Free text. |
| **Operator notes** | — | Free text; no identifying information. |
| **Camera** | rear / front | Rear (environment) default; front mirrors correctly. |
| **Pose model** | lite / full / heavy | Accuracy vs speed trade-off; default **full**. |
| **Safety checkbox** | — | Operator confirms participant is fit and supervised. |
| **Arms-crossed checkbox** | — | Confirms CDC protocol was briefed (arms on chest). |
| **Consent checkbox** | — | Shown only when a Sheets webhook is configured. |

### 4.2 Primary outcome

- **`stands_count`** — the 30STS score: number of full sit-to-stand repetitions in 30 seconds,
  determined by the offline, zero-lag analysis (the authoritative count). A live counter is shown
  during the test for feedback only (`live_count`), and `count_difference` audits the two.

### 4.3 Session, device & protocol metadata

`session_id`, `timestamp_utc`, `utc_offset_min`, `app_version`, `analysis_version`,
`schema_version`, `pose_model`, `pose_delegate`, `camera_facing`, `video_width_px`,
`video_height_px`, `user_agent`, `planned_duration_s`, `test_duration_s`, `manual_stop`,
`arms_crossed_confirmed`, `filter_cutoff_hz`, `resample_hz`.

### 4.4 Temporal metrics (pacing & fatigue)

| Metric | Unit | Meaning |
|---|---|---|
| `time_to_first_stand_s` | s | Reaction + first ascent to standing. |
| `cycle_time_mean_s`, `_sd_s`, `_cv_pct`, `_min_s`, `_max_s` | s / % | Interval between consecutive movement onsets and its variability. |
| `cycle_time_slope_s_per_rep` | s/rep | Least-squares trend across reps (fatigue/slowing). |
| `cycle_time_change_pct` | % | First-third vs last-third change in cycle time. |
| `ascent_time_mean_s`, `_sd_s` | s | Rise phase duration (10 %→90 % of hip excursion). |
| `descent_time_mean_s`, `_sd_s` | s | Lowering phase duration (90 %→10 %). |
| `standing_dwell_mean_s`, `seated_dwell_mean_s` | s | Time at the top / between reps. |

### 4.5 Hip (pelvis-proxy) kinematics

| Metric | Unit | Meaning |
|---|---|---|
| `hip_rise_mean_m` | m | Vertical hip travel onset→standing. |
| `peak_ascent_velocity_mean_m_s`, `_sd_m_s`, `_max_m_s` | m/s | Peak upward hip velocity (a power surrogate). |
| `ascent_mean_velocity_mean_m_s` | m/s | Mean ascent velocity (rise ÷ ascent time). |
| `peak_descent_velocity_mean_m_s` | m/s | Peak downward hip speed. |
| `ascent_velocity_change_pct` | % | First-third vs last-third velocity change. |
| `work_rate_proxy_mean_w` | W | mass × g × hip rise ÷ ascent time (proxy only; needs body mass). |

### 4.6 Joint & segment kinematics (sagittal plane)

| Metric | Unit | Meaning |
|---|---|---|
| `knee_flex_seated_mean_deg`, `knee_flex_standing_mean_deg`, `knee_rom_mean_deg` | ° | Knee flexion at onset, at standing, and range used. |
| `knee_ext_peak_velocity_mean_deg_s` | °/s | Peak knee extension angular velocity. |
| `hip_flex_seated_mean_deg`, `hip_flex_standing_mean_deg` | ° | Hip (trunk-thigh) flexion at onset and standing. |
| `hip_ext_peak_velocity_mean_deg_s` | °/s | Peak hip extension angular velocity. |
| `trunk_lean_peak_mean_deg`, `trunk_lean_peak_max_deg` | ° | Peak forward trunk inclination (momentum strategy). |
| `trunk_incl_standing_mean_deg` | ° | Trunk inclination at standing (0 = upright). |
| `shank_incl_peak_mean_deg` | ° | Peak shank inclination (knee forward of ankle). |
| `ankle_angle_range_mean_deg` | ° | Exploratory ankle ROM (foot landmarks least reliable). |

### 4.7 Calibration descriptors

`dominant_side`, `facing_direction`, `scale_m_per_px`, `scale_check_diff_pct`, `calib_chain_px`,
`calib_hip_rise_m`, `calib_standing_knee_flex_deg`, `calib_seated_knee_flex_deg`,
`calib_standing_trunk_incl_deg`, `calib_shank_from_vertical_deg`, `calib_seated_arm_dev`.

### 4.8 Normative classification

`norm_reference`, `norm_cutoff_below_average`, `norm_classification`
("Below average", "Average or above", or "Not classified"), `stands_first_half`,
`stands_second_half`, `incomplete_attempts`, `valid_for_norm`.

### 4.9 Quality-control fields

`effective_fs_hz`, `valid_frame_pct`, `imputed_sample_pct`, `longest_gap_s`,
`median_chain_visibility`, `view_obliquity_median`, `knee_2d_3d_diff_deg`,
`ankle_shift_shank_frac`, `arm_use_reps`, `qc_flags`, `qc_pass`.

### 4.10 Per-repetition table (`Reps`)

One row per detected rise (39 fields): identity (`rep_index`, `stand_number`, `counted`,
`counted_by_half_rule`, `full_stand_hip`, `full_stand_knee`); event times (`t_onset_s`, `t_half_s`,
`t_standing_s`, `t_descent_start_s`, `t_seat_contact_s`); phase durations (`ascent_time_s`,
`standing_dwell_s`, `descent_time_s`, `seated_dwell_s`, `cycle_time_s`); hip kinematics
(`peak_progress`, `hip_rise_m`, `peak_ascent_velocity_m_s`, `time_to_peak_velocity_s`,
`ascent_mean_velocity_m_s`, `peak_descent_velocity_m_s`, `work_rate_proxy_w`); joint/segment angles
(knee, hip, trunk, shank, ankle per rep); and protocol/tracking flags (`arm_dev_max`,
`arm_use_flag`, `tracking_gap_flag`).

### 4.11 Analysed time series (`Frames`, optional)

A uniform 30 Hz, zero-lag-filtered series (26 fields): `t_s`, `phase`, `tracking_gap`, `progress`,
`hip_up_m`, `hip_vel_m_s`, joint angles and angular velocities (knee, hip), `trunk_incl_deg`,
`shank_incl_deg`, `ankle_angle_deg`, 3-D cross-check angles, `arm_dev`, `obliquity`, and the
filtered pixel coordinates of shoulder/hip/knee/ankle. A separate **raw** frame CSV (device-rate,
unfiltered landmark x/y/z/visibility and world coordinates) is included in the ZIP download.

---

## 5. Scientific manual: the Sit-to-Stand test

### 5.1 Why sit-to-stand matters

Rising from a chair is one of the most mechanically demanding activities of daily living, requiring
the lower-limb extensors to raise and control the body's centre of mass against gravity through a
large range of motion. The ability to perform it repeatedly is a sensitive marker of lower-limb
muscle power, functional strength, balance, and fall risk in older adults (Bohannon, 2012; Jones,
Rikli & Beam, 1999). Because it needs no equipment beyond a chair, it is one of the most widely used
field tests in geriatrics, physiotherapy, and sports science.

Two closely related protocols dominate the literature:

- **Five-Times Sit-to-Stand (5×STS / FTSST):** the participant performs five repetitions as fast
  as possible; the outcome is the total **time** (seconds). It emphasises maximal effort and is
  common in balance and vestibular assessment (Whitney et al., 2005; Bohannon, 2006).
- **30-Second Chair Stand (30STS):** the participant performs **as many repetitions as possible in
  30 seconds**; the outcome is a **count**. It reduces floor/ceiling effects across a wide fitness
  range and is the test implemented here (Jones, Rikli & Beam, 1999; Rikli & Jones, 1999).

This application implements the **30STS** as standardised by the U.S. Centers for Disease Control
and Prevention's **STEADI** (Stopping Elderly Accidents, Deaths & Injuries) fall-prevention
initiative (CDC, 2017).

### 5.2 Standardised protocol (CDC STEADI)

- **Chair:** firm, straight-backed, no armrests, seat height **≈ 43.2 cm (17 in)**, placed against a
  wall for safety.
- **Start position:** seated in the middle of the chair, back straight, feet flat on the floor,
  **arms crossed over the chest** (hands to opposite shoulders).
- **Task:** on "Go", stand to a **full upright position** and return to fully seated, repeating as
  many times as possible for **30 seconds**.
- **Counting rule:** count a stand each time the participant reaches full standing. If the
  participant is **more than halfway up** when time expires, that repetition counts (the CDC
  **half-way rule**).
- **Invalidating condition:** if the participant uses their **arms to push off**, the trial is
  invalid for normative comparison.

The app reproduces each rule computationally (see §8).

### 5.3 Measurement properties

Across populations, the 30STS shows good test–retest reliability (intraclass correlation
coefficients commonly reported around 0.84–0.92 in community-dwelling and clinical samples) and
concurrent validity against lower-limb strength and power measures (Jones, Rikli & Beam, 1999;
Bohannon, 2012; McAllister & Palombaro, 2020). It discriminates fallers from non-fallers and tracks
change after exercise interventions, which is why STEADI adopted it as a core screening item (CDC,
2017; Applebaum et al., 2017). As with any field test, performance is influenced by chair height,
footwear, instruction, and motivation — hence the strict standardisation above.

### 5.4 Clinical interpretation in context

A low 30STS score should be interpreted alongside gait speed, the Timed Up-and-Go, and clinical
history rather than in isolation. The count is a **functional-capacity** measure: it integrates
strength, power, balance, coordination, and endurance. The kinematic metrics this app adds (ascent
velocity, trunk lean, cycle-time slope) are intended to describe **how** the movement is performed —
for example, whether a participant relies on trunk momentum, slows across the 30 s (fatigue), or
shows asymmetric pacing — information a simple count cannot capture.

---

## 6. Biomechanics of the sit-to-stand movement

### 6.1 Movement phases

The sit-to-stand (STS) cycle is conventionally divided into phases. A common four-phase scheme
(after Schenkman et al., 1990) is:

1. **Flexion-momentum phase** — forward trunk rotation about the hips generates horizontal momentum
   before the thighs leave the seat.
2. **Momentum-transfer (seat-off) phase** — body weight transfers from the chair to the feet; this
   is the moment of peak demand and greatest instability.
3. **Extension phase** — coordinated hip and knee extension raises the centre of mass to standing.
4. **Stabilisation phase** — the body settles into quiet standing.

This app operationalises the cycle on the vertical **hip-height progress** signal `p(t)` (0 =
seated, 1 = standing), detecting onset (10 % of excursion), the 50 % crossing (used for counting),
standing (90 %), descent start, and seat contact (see §8).

### 6.2 Joint kinetics and the demand of rising

Rising requires large **net extensor moments** at the hip and knee, with the knee extensors
(quadriceps) and hip extensors (gluteals, hamstrings) as prime movers, assisted by the ankle
plantar/dorsiflexors for anteroposterior balance. Peak joint moments and powers during STS are
among the highest seen in daily activity and scale with seat height and movement speed (Winter,
2009; Yoshioka et al., 2009). Lower seats and faster rises both increase the required knee-extensor
moment, which is why seat height is standardised.

### 6.3 Movement strategies

Two broad strategies are described (Hughes et al., 1994):

- **Momentum-transfer strategy** — greater forward trunk lean generates angular momentum that is
  transferred to vertical rise, reducing the peak extensor moment required but demanding better
  balance control at seat-off.
- **Stabilisation (force-control) strategy** — a more upright trunk with slower, more controlled
  extension; common where balance confidence is low.

The app's **trunk-lean** and **ascent-velocity** metrics are designed to describe where a
participant sits on this continuum, and the per-rep table reveals whether strategy changes with
fatigue across the 30 s.

### 6.4 Why hip velocity is a power surrogate

Lower-limb **muscle power** (force × velocity) declines earlier and faster than maximal strength
with ageing and is more strongly associated with functional performance and fall risk (Reid &
Fielding, 2012). Measuring power directly needs force plates or instrumented systems. During STS,
the vertical velocity of the centre of mass — approximated here by the **hip (pelvis) marker** —
rises and falls with the power output of the extensors. Peak and mean ascent velocity therefore
serve as accessible, camera-derived **surrogates** of lower-limb power, and the "work-rate proxy"
(mass × g × hip rise ÷ ascent time) gives a crude vertical power estimate (not validated mechanical
power).

### 6.5 Anthropometric scaling

The app converts pixels to metres using the participant's **standing height** and Winter's (2009)
segment-length fractions: the shoulder–hip–knee–ankle chain is modelled as **0.779 × stature**
(trunk 0.288 H + thigh 0.245 H + shank 0.246 H). Because this chain is rigid relative to the body,
the pixel-to-metre scale derived from the standing posture is approximately posture-invariant,
assuming a side-on camera at the participant's depth plane.

---

## 7. Computer-vision & signal-processing methods

### 7.1 Pose estimation

Pose is estimated **entirely on-device** in the browser using **Google MediaPipe Pose Landmarker**,
which runs the **BlazePose GHUM** topology — a 33-landmark, full-body model that outputs both 2-D
image coordinates (with a per-landmark visibility score) and 3-D "world" landmarks in metres
relative to the hip midpoint (Bazarevsky et al., 2020; Grishchenko et al., 2020). Inference uses the
GPU delegate where available, falling back to CPU. Three model variants trade accuracy for speed
(`lite`, `full` — default, `heavy`).

The app records **17 of the 33 landmarks** relevant to STS: nose; both shoulders, elbows, wrists,
hips, knees, ankles, heels and foot-indices (MediaPipe indices 0, 11–16, 23–32). The near-camera
("dominant") side is chosen automatically by landmark visibility and drives all kinematics, which is
appropriate for a sagittal (side-on) recording.

Reported accuracy of markerless single-camera pose for joint-centre localisation is on the order of
a few centimetres under good conditions and degrades with occlusion, loose clothing, and oblique
camera angles (Needham et al., 2021). These limitations motivate the quality-control system in §9.

### 7.2 From landmarks to signals

For each recorded frame the 17 landmarks are stored as normalised image coordinates plus visibility.
Offline (after the 30 s), the pipeline:

1. **Gap handling & resampling** — each marker's trajectory is linearly resampled onto a uniform
   **30 Hz** grid; samples inside a tracking gap longer than `maxGapS` (0.25 s) are flagged and
   bridged by interpolation.
2. **Zero-lag low-pass filtering** — a 2nd-order Butterworth filter is applied **forward and
   backward** (filtfilt), giving a 4th-order, **zero-phase** response with an effective −3 dB cutoff
   of **6 Hz** (human STS content is < 5 Hz; Winter, 2009). The design cutoff is corrected by
   1/0.802 to compensate for the dual pass; signals are reflection-padded to suppress edge
   transients. Zero phase lag means event timing is not biased by the filter.
3. **Pixel→metre scaling** — from standing height and the segment-chain model (§6.5).
4. **Hip-progress signal `p(t)`** — vertical hip position normalised between the calibrated seated
   (0) and standing (1) heights. Because it is scale-free, repetition detection does not depend on
   the metre scale.

### 7.3 Automatic calibration (Option A)

Rather than a separate "hold still" calibration, the app derives the seated and standing references
**from the test motion itself**: it identifies the frames at the **lowest** hip position (seated)
and the **highest** hip position (standing) and uses windows around each extreme to build the
calibration object — the pixel chain length (scale), the seated/standing hip heights, and the
dominant side/facing. If the recorded motion contains too little vertical excursion to separate
sitting from standing, the app asks the operator to re-record. This preserves rep counts and the
timing/angle metrics; absolute metre-based values are slightly rougher than with a dedicated static
standing calibration.

### 7.4 Joint-angle definitions

All 2-D angles are computed in the sagittal plane from the dominant-side landmarks (`d` = facing
direction, ±1):

- **Knee flexion** = 180° − ∠(hip, knee, ankle); 0° = fully extended.
- **Hip flexion** = 180° − ∠(shoulder, hip, knee); 0° = trunk and thigh collinear.
- **Trunk inclination** = atan2(d·(shoulder_x − hip_x), hip_y − shoulder_y); 0° = vertical,
  positive = forward lean.
- **Shank inclination** = analogous (ankle→knee); positive = knee anterior to ankle.
- **Ankle angle** (exploratory) from knee–ankle–toe; foot landmarks are the least reliable.

Knee and hip angles are **cross-checked** against the 3-D world landmarks; a large mean 2-D vs 3-D
discrepancy flags an oblique camera view (§9).

---

## 8. How each metric is computed

**Repetition detection (state machine).** On the progress signal `p(t)`, a stand *attempt* begins
when `p` rises through `stateHi = 0.6` and ends when it falls back through `stateLo = 0.4`
(hysteresis prevents double-counting). Within each attempt the local trough and peak define the
excursion; **onset** is the 10 % crossing, **standing** the 90 % crossing, and **t50** the 50 %
crossing used for the counting window.

**Counted stand.** A rise is counted if its **t50 falls within [0, 30] s** AND it **reached full
stand** — peak progress ≥ `fullStandProgress` (0.85) and knee flexion at standing ≤ calibrated
standing knee flexion + `kneeExtToleranceDeg` (20°) — **OR** it satisfies the **CDC half-way rule**
(the peak occurs after 30 s while `p` is already ≥ 0.5). Rises that pass the attempt threshold but
not the full-stand criteria are logged as `incomplete_attempts`.

**Temporal metrics.** Cycle time = interval between consecutive onsets. Mean, SD, CV, min, max, the
rep-wise least-squares **slope** (fatigue trend, ≥ 4 cycles), and the **first-third vs last-third**
change (≥ 6 reps) are derived from the per-rep cycle times. Ascent, descent, standing-dwell and
seated-dwell durations come from the event times above.

**Hip kinematics.** Hip rise (metres) = vertical hip travel onset→standing. Hip velocity is the
central-difference derivative of the filtered hip-height signal; per-rep peak ascent velocity, mean
ascent velocity (rise ÷ ascent time), and peak descent speed are summarised across counted reps. The
work-rate proxy = mass × 9.81 × hip rise ÷ ascent time (null if body mass is not entered).

**Joint & segment metrics.** Per rep, knee/hip flexion at onset and standing, ROM, and peak
extension angular velocities; peak trunk lean and standing trunk inclination; peak shank inclination;
exploratory ankle ROM. Session values are means (and max where noted) over counted reps.

**Normative classification.** If the session is **valid for norms** (QC passes, full 30 s,
arms-crossed confirmed, age 60–94, sex male/female), `stands_count` is compared against the CDC
STEADI below-average cut-point for the participant's age band and sex; otherwise the result is
"Not classified".

---

## 9. Quality control and validity

Because single-camera markerless pose has known error sources, every session is screened and a
`qc_flags` list plus a `qc_pass` boolean are produced. **Blocking** flags withhold the normative
classification (`valid_for_norm = FALSE`). Key flags:

| Flag | Blocking | Trigger |
|---|---|---|
| `LOW_FPS` | yes | Detector throughput < 15 fps (timing precision reduced). |
| `LOW_VALID_FRAMES` | yes | < 90 % of frames had shoulder/hip/knee/ankle all confidently detected. |
| `TRACKING_GAPS` | yes | Imputed samples > 10 % or a gap > 2 × 0.25 s. |
| `CAMERA_OR_FEET_SHIFT` | yes | Ankle moved > 15 % of shank length vs calibration (camera/feet moved). |
| `NOT_SEATED_AT_START` | yes | Participant not at seated baseline before the start. |
| `MOVED_BEFORE_GO` | yes | Hip rose before the "Go" signal. |
| `ARM_USE_SUSPECTED` | yes | Wrists left the chest during a rise (CDC: invalidates the test). |
| `MANUAL_STOP` | yes | Operator stopped before 30 s. |
| `HIP_RISE_IMPLAUSIBLE` | yes | Calibrated hip rise outside 0.15–0.65 m (check height entry). |
| `FACING_AMBIGUOUS` | yes | Knee- and foot-based facing direction disagree. |
| `OBLIQUE_VIEW` | no | Hip separation / trunk length > 0.2 (camera not perpendicular). |
| `SCALE_INCONSISTENT` | no | Chain length during the test differs > 10 % from calibration. |
| `CAMERA_TILT` | no | Standing shank > 5° from vertical in the image. |
| `KNEE_2D_3D_DISAGREE` | no | 2-D vs 3-D knee angle differs > 10° (often an oblique view). |

**Arm-use detection** is a heuristic (wrist distance from the shoulder midpoint, in trunk lengths,
exceeding the seated baseline for ≥ 0.2 s) and should be confirmed by observation when it matters.

---

## 10. Normative data and interpretation

The app classifies against the **CDC STEADI 30-Second Chair Stand** below-average cut-points
(community-dwelling adults, 60–94 years). "Below average" means **fewer** stands than the age/sex
cut-point. These are **screening** cut-points, not diagnoses, and apply only within the published
age range. The underlying normative framework derives from the Senior Fitness Test normative study
of 7,000+ older adults (Rikli & Jones, 1999). Example cut-points (stands below which is "below
average"):

| Age band | Men | Women |
|---|---|---|
| 60–64 | 14 | 12 |
| 65–69 | 12 | 11 |
| 70–74 | 12 | 10 |
| 75–79 | 11 | 10 |
| 80–84 | 10 | 9 |
| 85–89 | 8 | 8 |
| 90–94 | 7 | 4 |

Interpret a count together with gait speed, Timed Up-and-Go, strength testing, and clinical history.

---

## 11. Limitations

- **Single 2-D camera:** joint angles are sagittal-plane projections; error grows with camera
  obliquity and perspective. Treat angles as relative measures unless validated against
  marker-based motion capture.
- **Pelvis proxy:** the hip landmark is not an anatomical joint centre and can drift under loose
  clothing or poor contrast.
- **No bilateral symmetry:** a side view cannot assess left/right differences.
- **Arm-use detection is heuristic** — verify visually.
- **Timing** is limited by device frame rate; capture latency can offset absolute alignment to the
  "Go" beep by tens of milliseconds (durations are unaffected).
- **Unvalidated thresholds:** parameters marked `[TUNE]` in `config.js` and the full-stand criteria
  require a concurrent-validity study (ideally against optical motion capture and a manual count)
  before clinical use.
- **Auto-calibration (Option A)** trades a small amount of absolute metre-scale accuracy for ease of
  use; counts and timing are unaffected.
- **Normative scope:** STEADI cut-points apply to community-dwelling adults 60–94 only.

---

## 12. Project structure & developer notes

```
index.html              entry point (loads css/ + js/)
css/styles.css          TRON theme (Orbitron + Rajdhani, neon blue/orange, responsive)
js/
  config.js             all analysis parameters (CONFIG) + Google Sheets webhook
  schema.js             data schema — single source of truth (SCHEMA)
  analysis.js           offline biomechanics engine (STSAnalysis) — validated, unit-tested
  export.js             CSV / ZIP / Google Sheets / local outbox (Exporter)
  charts.js             dependency-free canvas charts (Charts)
  pose-engine.js        MediaPipe + camera + skeleton overlay (PoseEngine)
  app.js                UI controller / screen flow
tests/                  Node unit tests for the engine (run.js, synth.js)
tools/build-dictionary.js   regenerates DATA_DICTIONARY.md from schema.js + config.js
apps-script/Code.gs     Google Sheets receiver (§3)
DATA_DICTIONARY.md      auto-generated field documentation
```

The analysis engine is covered by unit tests against synthetic ground-truth motion:

```powershell
node tests/run.js            # all tests must pass
node tools/build-dictionary.js   # regenerate DATA_DICTIONARY.md after any schema/config change
```

Browser support: modern Chrome / Edge / Safari (desktop and mobile). The first load fetches the
MediaPipe runtime and pose model from a CDN; thereafter the camera stream and all pose inference run
on-device, and video never leaves the browser.

---

## 13. References (APA 7th edition)

Applebaum, E. V., Breton, D., Feng, Z. W., Ta, A.-T., Walsh, K., Chassé, K., & Robbins, S. M. (2017).
Modified 30-second Sit to Stand test predicts falls in a cohort of institutionalized older veterans.
*PLOS ONE, 12*(5), e0176946. https://doi.org/10.1371/journal.pone.0176946

Bazarevsky, V., Grishchenko, I., Raveendran, K., Zhu, T., Zhang, F., & Grundmann, M. (2020).
*BlazePose: On-device real-time body pose tracking* (arXiv:2006.10204). arXiv.
https://doi.org/10.48550/arXiv.2006.10204

Bohannon, R. W. (2006). Reference values for the Five-Repetition Sit-to-Stand Test: A descriptive
meta-analysis of data from elders. *Perceptual and Motor Skills, 103*(1), 215–222.
https://doi.org/10.2466/pms.103.1.215-222

Bohannon, R. W. (2012). Measurement of sit-to-stand among older adults. *Topics in Geriatric
Rehabilitation, 28*(1), 11–16. https://doi.org/10.1097/TGR.0b013e31823415fa

Centers for Disease Control and Prevention. (2017). *The 30-Second Chair Stand Test* [STEADI
assessment]. U.S. Department of Health and Human Services.

Grishchenko, I., Bazarevsky, V., Zhang, F., Raveendran, K., Zhu, T., & Grundmann, M. (2020).
*BlazePose GHUM Holistic: Real-time 3D human landmarks and pose estimation.* Google Research.

Hughes, M. A., Weiner, D. K., Schenkman, M. L., Long, R. M., & Studenski, S. A. (1994). Chair rise
strategies in the elderly. *Clinical Biomechanics, 9*(3), 187–192.
https://doi.org/10.1016/0268-0033(94)90020-5

Jones, C. J., Rikli, R. E., & Beam, W. C. (1999). A 30-s chair-stand test as a measure of lower body
strength in community-residing older adults. *Research Quarterly for Exercise and Sport, 70*(2),
113–119. https://doi.org/10.1080/02701367.1999.10608028

McAllister, L. S., & Palombaro, K. M. (2020). Modified 30-Second Sit-to-Stand Test: Reliability and
validity in older adults unable to complete traditional sit-to-stand testing. *Journal of Geriatric
Physical Therapy, 43*(3), 153–158. https://doi.org/10.1519/JPT.0000000000000227

Needham, L., Evans, M., Cosker, D. P., Wade, L., McGuigan, P. M., Bilzon, J. L., & Colyer, S. L.
(2021). The accuracy of several pose estimation methods for 3D joint centre localisation.
*Scientific Reports, 11*, 20673. https://doi.org/10.1038/s41598-021-00212-x

Reid, K. F., & Fielding, R. A. (2012). Skeletal muscle power: A critical determinant of physical
functioning in older adults. *Exercise and Sport Sciences Reviews, 40*(1), 4–12.
https://doi.org/10.1097/JES.0b013e31823b5f13

Rikli, R. E., & Jones, C. J. (1999). Functional fitness normative scores for community-residing
older adults, ages 60–94. *Journal of Aging and Physical Activity, 7*(2), 162–181.
https://doi.org/10.1123/japa.7.2.162

Schenkman, M., Berger, R. A., Riley, P. O., Mann, R. W., & Hodge, W. A. (1990). Whole-body movements
during rising to standing from sitting. *Physical Therapy, 70*(10), 638–648.
https://doi.org/10.1093/ptj/70.10.638

Whitney, S. L., Wrisley, D. M., Marchetti, G. F., Gee, M. A., Redfern, M. S., & Furman, J. M. (2005).
Clinical measurement of sit-to-stand performance in people with balance disorders: Validity of data
for the Five-Times-Sit-to-Stand Test. *Physical Therapy, 85*(10), 1034–1045.
https://doi.org/10.1093/ptj/85.10.1034

Winter, D. A. (2009). *Biomechanics and motor control of human movement* (4th ed.). John Wiley &
Sons. https://doi.org/10.1002/9780470549148

Yoshioka, S., Nagano, A., Hay, D. C., & Fukashiro, S. (2009). Biomechanical analysis of the
relation between movement time and joint moment development during a sit-to-stand task. *BioMedical
Engineering OnLine, 8*, 27. https://doi.org/10.1186/1475-925X-8-27
