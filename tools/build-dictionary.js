/** Generates DATA_DICTIONARY.md from schema.js + config.js.  Run: node tools/build-dictionary.js */
const fs = require('fs'), path = require('path');
const CONFIG = require('../js/config.js'), SCHEMA = require('../js/schema.js');
const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const C = CONFIG, o = [];
const p = (...a) => o.push(a.join(''));

function fieldTable(fields) {
    let g = null;
    fields.forEach((f, i) => {
        if (f.group !== g) { g = f.group; if (g) p('\n**', g, '**\n'); p('| # | Column | Type | Unit | Description | Calculation / source |'); p('|---|---|---|---|---|---|'); }
        p('| ', i + 1, ' | `', f.key, '` | ', esc(f.type), ' | ', esc(f.unit), ' | ', esc(f.desc), ' | ', esc(f.calc), ' |');
    });
}

p('# Data Dictionary — ', C.app.name);
p('\nApp ', C.app.version, ' · analysis ', C.app.analysisVersion, ' · schema ', C.app.schemaVersion, '. **Generated** from `schema.js` and `config.js` — do not edit by hand; run `node tools/build-dictionary.js`.\n');
p('## 1. Conventions\n');
p('- **Time** `t = 0` is the "Go" signal. Negative times are the pre-roll (seated, before Go). Times in seconds unless a column ends `_ms`.');
p('- **Image coordinates** MediaPipe normalised x (0 left → 1 right) and y (0 top → 1 bottom) of the video frame; `z` is relative depth (smaller = nearer the camera, scale ≈ x). Raw x/y are of the *un-mirrored* video, regardless of on-screen mirroring.');
p('- **Vertical quantities** reported positive **upward** (image y is flipped). Angles in degrees. `null`/empty = not computable.');
p('- **World landmarks** metres, origin at the hip midpoint, axes per MediaPipe (x right, y down, z toward camera). Used only as a 3D cross-check of the 2D angles.');
p('- **Sagittal (side-on) view assumed.** The dominant (camera-near) side is chosen at calibration by landmark visibility; the facing direction `d` (±1) is derived from knee/foot position relative to the hip.');
p('- **Sign conventions** knee flexion 0° = fully extended; hip flexion 0° = trunk and thigh collinear; trunk inclination 0° = vertical, **positive = leaning forward** (toward facing direction); shank inclination 0° = vertical, positive = knee forward of ankle.');
p('- Booleans export as `TRUE`/`FALSE` in CSV.\n');

p('## 2. Summary table (`Sessions` sheet / `*_summary.csv`) — one row per test\n');
fieldTable(SCHEMA.summary);
p('\n## 3. Rep table (`Reps` sheet / `*_reps.csv`) — one row per detected stand attempt\n');
fieldTable(SCHEMA.reps);
p('\n## 4. Analysed time series (`*_frames_analysis.csv`, optional `Frames` sheet) — uniform ', C.signal.resampleHz, ' Hz\n');
fieldTable(SCHEMA.frames);

p('\n## 5. Raw landmark frames (`*_frames_raw.csv`)\n');
p('One row per processed video frame (irregular timing, i.e. the device\'s actual detection rate). Columns: `t_ms` (ms from Go, rounded) followed, for each marker key in §6, by:\n');
p('| Suffix | Meaning | Unit |\n|---|---|---|');
p('| `_x`, `_y` | Normalised image position | 0–1 of frame width / height |');
p('| `_z` | Normalised relative depth (MediaPipe image z) | ≈ frame-width units |');
p('| `_v` | MediaPipe visibility (probability the landmark is visible and not occluded) | 0–1 |');
p('| `_wx`, `_wy`, `_wz` | World landmark | m (blank if world data unavailable) |');
p('\nExample columns: `l_hip_x`, `l_hip_y`, `l_hip_z`, `l_hip_v`, `l_hip_wx`, … Total columns = 1 + ', C.tracked.length, ' × 7 = ', 1 + C.tracked.length * 7, '. Values rounded to 4 d.p.\n');

p('## 6. Tracked pose markers (MediaPipe Pose Landmarker, 33-point model; ', C.tracked.length, ' recorded)\n');
p('| Key | MediaPipe index | Name | Role in this app |\n|---|---|---|---|');
C.tracked.forEach(m => p('| `', m.key, '` | ', m.idx, ' | ', m.name, ' | ', esc(m.role), ' |'));
p('\nThe remaining 16 landmarks (eyes, ears, mouth, hands, pinky/index fingers, thumbs) are not recorded. Live overlay shows tracked markers (filled = visibility ≥ ', C.signal.minVisibility, ', hollow yellow = below); optional label shows visibility %. Pose model: ', Object.keys(C.pose.models).join(' / '), ' (default ', C.pose.defaultModel, '), detect/presence/tracking confidence ', C.pose.detectionConfidence, '/', C.pose.presenceConfidence, '/', C.pose.trackingConfidence, ', ', C.pose.numPoses, ' pose.\n');

p('## 7. Definitions of derived quantities\n');
const def = [
    ['Valid marker sample', `A landmark in a frame with visibility ≥ ${C.signal.minVisibility} and inside the frame. Invalid samples are treated as missing, bridged by linear interpolation, and flagged when the gap exceeds ${C.signal.maxGapS} s.`],
    ['Resampling & filtering', `Frames are linearly resampled to ${C.signal.resampleHz} Hz, padded with ${C.signal.padSamples} odd-reflected samples at each end, then low-passed with a 2nd-order Butterworth applied forward and backward (zero phase lag, no timing bias). Design cutoff is chosen so the effective −3 dB point is ${C.signal.cutoffHz} Hz (Winter 2009: human STS content is < 5 Hz).`],
    ['Scale (m per px)', `Participant height × ${C.anthropometry.segmentChainFractionOfHeight} (Winter 2009 trunk 0.288 H + thigh 0.245 H + shank 0.246 H) ÷ pixel length of the shoulder–hip–knee–ankle chain in the standing calibration. The chain is rigid, so the scale is posture-invariant but assumes a side-on camera at the participant's depth.`],
    ['Hip height / hip up (m)', 'Vertical position of the dominant-side hip landmark (pelvis proxy), positive upward, relative to the seated calibration, converted with the scale.'],
    ['Progress p(t)', 'p = (hip height − seated hip height) ÷ (standing hip height − seated hip height); 0 = seated calibration, 1 = calibrated standing. Scale-free, so rep detection does not depend on the m/px scale.'],
    ['Stand attempt', `State machine on p(t) with hysteresis: attempt begins when p rises through ${C.events.stateHi}, ends when it falls back through ${C.events.stateLo}.`],
    ['Events', `Onset / seat-contact: p at ${C.events.lowPct * 100}% of the local excursion; "standing reached" / "descent start": ${C.events.highPct * 100}%; t50: p = ${C.protocol.halfwayProgress}. Phases: ASCENT (onset → standing reached), STANDING, DESCENT (descent start → seat contact), SEATED.`],
    ['Counted stand', `t50 inside [0, ${C.protocol.durationS}] s AND (peak p ≥ ${C.events.fullStandProgress} AND knee flexion at stand ≤ calibrated standing knee flexion + ${C.events.kneeExtToleranceDeg}°) OR (peak occurs after ${C.protocol.durationS} s while p already ≥ ${C.protocol.halfwayProgress} — CDC half-way rule).`],
    ['Joint angles (2D)', 'Knee flexion = 180° − ∠(hip, knee, ankle). Hip flexion = 180° − ∠(shoulder, hip, knee). Trunk inclination = atan2(d·(shoulder.x − hip.x), hip.y − shoulder.y). Shank inclination analogous (ankle→knee). Ankle angle (exploratory) from knee–ankle–toe. d = facing direction.'],
    ['3D cross-check', 'Knee and hip angles recomputed from world landmarks; the mean absolute difference vs 2D is reported and flagged if > ' + C.qc.maxKnee2D3DDiffDeg + '°.'],
    ['Arm use', `Wrist distance from the shoulder midpoint in trunk lengths, minus the seated-calibration value; suspected if > ${C.arms.deviationThreshold} for ≥ ${C.arms.minDurationS} s during a rise. Heuristic — not a substitute for observation.`],
    ['Fatigue / trend', 'Least-squares slope of cycle time vs stand number (needs ≥ 4 reps), plus first-vs-last-third comparisons as listed in the summary table.'],
    ['Work-rate proxy', 'Per rep: body mass × 9.81 × hip rise during ascent ÷ ascent time (W); session value is the mean. Hip rise approximates centre-of-mass rise: a proxy, not true mechanical power.'],
    ['Normative classification', 'CDC STEADI below-average cut-points (age 60–94, male/female). Only assigned if `valid_for_norm` (no blocking QC flag).']
];
p('| Term | Definition |\n|---|---|');
def.forEach(d => p('| **', d[0], '** | ', esc(d[1]), ' |'));

p('\n## 8. Quality-control flags (`qc_flags`, semicolon-separated)\n');
const flags = [
    ['LOW_FPS', `Effective detection rate < ${C.qc.minEffectiveFps} fps.`],
    ['LOW_VALID_FRAMES', `< ${C.qc.minValidFramePct}% of frames had shoulder, hip, knee and ankle valid.`],
    ['TRACKING_GAPS', `Imputed samples > ${C.qc.maxImputedPct}% or longest gap > 2 × ${C.signal.maxGapS} s.`],
    ['CAMERA_OR_FEET_SHIFT', `Ankle moved > ${C.qc.maxAnkleShiftShankFrac * 100}% of shank length from calibration.`],
    ['NOT_SEATED_AT_START', 'Median pre-roll progress > 0.2 (participant not at seated baseline before Go).'],
    ['MOVED_BEFORE_GO', 'Hip rose before Go.'],
    ['ARM_USE_SUSPECTED', 'See Arm use (§7).'],
    ['MANUAL_STOP', 'Operator stopped before the planned duration.'],
    ['HIP_RISE_IMPLAUSIBLE', `Calibrated hip rise outside [${C.calibration.hipRiseRangeM.join(', ')}] m.`],
    ['FACING_AMBIGUOUS', 'Knee-based and foot-based facing direction disagree.'],
    ['OBLIQUE_VIEW', `Hip separation / trunk length > ${C.qc.maxObliquity} (camera not side-on).`],
    ['SCALE_INCONSISTENT', `Chain length during test differs > ${C.qc.maxScaleDiffPct}% from calibration.`],
    ['CAMERA_TILT', `Standing shank > ${C.qc.maxShankVerticalDeg}° from vertical in image.`],
    ['STANDING_CAL_KNEE_FLEXED', `Standing-calibration knee flexion > ${C.calibration.standMaxKneeFlexDeg}°.`],
    ['KNEE_2D_3D_DISAGREE', `2D vs 3D knee angle mean difference > ${C.qc.maxKnee2D3DDiffDeg}°.`],
    ['NO_REPS_DETECTED', 'No stand detected.']
];
p('Blocking flags (set `valid_for_norm = FALSE`, withhold normative classification): ', C.qc.blocking.map(f => '`' + f + '`').join(', '), '.\n');
p('| Flag | Blocking | Trigger |\n|---|---|---|');
flags.forEach(f => p('| `', f[0], '` | ', C.qc.blocking.includes(f[0]) ? 'yes' : 'no', ' | ', esc(f[1]), ' |'));

p('\n## 9. Algorithm parameters (snapshot is also stored in each `*_session.json`)\n');
p('Parameters marked **[TUNE]** in `config.js` are engineering defaults **not yet validated** against a criterion measure.\n');
p('| Parameter | Default |\n|---|---|');
for (const sec of ['protocol', 'calibration', 'signal', 'events', 'arms', 'qc', 'live'])
    for (const [k, v] of Object.entries(C[sec])) p('| `', sec, '.', k, '` | ', esc(JSON.stringify(v)), ' |');

p('\n## 10. Limitations\n');
[
    'Single 2D camera: joint angles are sagittal-plane projections; error grows with camera obliquity and perspective. Treat as relative measures unless validated against marker-based motion capture.',
    'Hip landmark is a pelvis proxy; MediaPipe landmarks are not anatomical landmarks and can drift under loose clothing or poor contrast.',
    'No bilateral symmetry metrics: a side view cannot assess left/right differences.',
    'Arm-use detection is a heuristic; verify visually when it matters.',
    'Timing is limited by the device frame rate; frame timestamps include camera capture latency, so absolute alignment to the Go beep may be offset by tens of ms (durations are unaffected).',
    'Thresholds marked [TUNE] and the full-stand criteria need a concurrent-validity study (e.g. against manual video count and, ideally, optical motion capture) before clinical use.',
    'STEADI norms are for community-dwelling adults 60–94 and are screening cut-points, not diagnoses.'
].forEach(l => p('- ', l));

p('\n## 11. References\n');
[
    'Jones CJ, Rikli RE, Beam WC. A 30-s chair-stand test as a measure of lower body strength in community-residing older adults. Res Q Exerc Sport 1999;70(2):113–119.',
    'Rikli RE, Jones CJ. Functional fitness normative scores for community-residing older adults, ages 60–94. J Aging Phys Act 1999;7:162–181.',
    'CDC. STEADI — 30-Second Chair Stand Test (2017).',
    'Winter DA. Biomechanics and Motor Control of Human Movement, 4th ed. Wiley, 2009 (anthropometry, signal filtering).',
    'Bazarevsky V et al. BlazePose: On-device real-time body pose tracking. arXiv:2006.10204, 2020.',
    'Needham L et al. The accuracy of several pose estimation methods for 3D joint centre localisation. Sci Rep 2021;11:20673.'
].forEach(l => p('- ', l));

fs.writeFileSync(path.join(__dirname, '..', 'DATA_DICTIONARY.md'), o.join('\n') + '\n');
console.log('DATA_DICTIONARY.md written:', o.length, 'lines;', SCHEMA.summary.length, 'summary,', SCHEMA.reps.length, 'rep,', SCHEMA.frames.length, 'frame fields');
