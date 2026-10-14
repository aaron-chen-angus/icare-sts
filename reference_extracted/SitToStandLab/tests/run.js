/* Unit tests for the analysis pipeline using synthetic ground-truth data. Run: node tests/run.js */
const CONFIG = require('../config.js');
const SCHEMA = require('../schema.js');
const A = require('../analysis.js');
const { makeSession, truth, W, H } = require('./synth.js');

let fails = 0;
const ok = (cond, msg, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined ? '  [' + extra + ']' : '')); if (!cond) fails++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg, 'got ' + a + ', expect ' + b + ' +/-' + tol);

const participant = { id: 'T001', age: 72, sex: 'female', heightCm: 170, massKg: 70, chairCm: 43.2, armsCrossed: true, site: 'unit-test', notes: '' };
const baseMeta = { sessionId: 'sess-1', timestampUtc: new Date().toISOString(), utcOffsetMin: 480, poseModel: 'full', delegate: 'GPU', cameraFacing: 'environment', userAgent: 'node', elapsedS: 30, manualStop: false, liveCount: null };

function run(opts, metaOver, ptOver) {
    const s = makeSession(opts);
    const calib = A.buildCalibration(s.standFrames, s.seatFrames, W, H, 170, CONFIG);
    const res = A.analyzeSession({ recording: s.recording, calib, participant: Object.assign({}, participant, ptOver || {}), meta: Object.assign({}, baseMeta, metaOver || {}), cfg: CONFIG, schema: SCHEMA });
    return { s, calib, res };
}
const onsetsA = Array.from({ length: 13 }, (_, i) => 1.0 + 2.4 * i);

console.log('--- A: 12 clean reps, 2.4 s cycle, 1 ms-level truth comparison');
{
    const { calib, res } = run({ onsets: onsetsA, noise: 0.0015, seed: 3 }, { liveCount: 12 });
    ok(!res.error, 'analysis ran', res.error);
    const S = res.summary, tr = truth(onsetsA[0], {});
    console.log('   flags:', S.qc_flags || '(none)');
    near(calib.scale, 1.7 * 0.779 / (1.3241 * 600), 3e-5, 'scale m/px');
    near(calib.hipRiseM, tr.hipStand, 0.01, 'calibrated hip rise (m)');
    ok(S.stands_count === 12, 'stands_count == 12', S.stands_count);
    ok(S.count_difference === 0, 'live vs offline agree');
    near(S.cycle_time_mean_s, 2.4, 0.03, 'cycle time mean');
    near(S.ascent_time_mean_s, tr.ascent, 0.06, 'ascent time mean vs truth');
    near(S.hip_rise_mean_m, tr.rise, 0.012, 'hip rise (10-90%) vs truth');
    near(S.peak_ascent_velocity_mean_m_s, tr.vmax, tr.vmax * 0.12, 'peak ascent velocity vs truth');
    near(S.trunk_lean_peak_mean_deg, tr.lean, 3, 'peak trunk lean vs truth');
    near(S.knee_flex_standing_mean_deg, 0, 3, 'standing knee flexion ~0');
    ok(S.knee_flex_seated_mean_deg > 60 && S.knee_flex_seated_mean_deg < 90, 'seated knee flexion plausible', S.knee_flex_seated_mean_deg);
    ok(S.qc_pass === true, 'qc_pass', S.qc_flags);
    ok(S.valid_for_norm === true && S.norm_classification === 'Average or above', 'norm classification (72 F, 12 stands >= 10)', S.norm_classification);
    ok(S.norm_cutoff_below_average === 10, 'STEADI cutoff 72F = 10', S.norm_cutoff_below_average);
    ok(S.stands_first_half === 6 && S.stands_second_half === 6, 'halves 6/6', S.stands_first_half + '/' + S.stands_second_half);
    ok(S.cycle_time_cv_pct < 3, 'cycle CV small', S.cycle_time_cv_pct);
    ok(Math.abs(S.knee_2d_3d_diff_deg) < 5, '2D vs 3D knee agree', S.knee_2d_3d_diff_deg);
    ok(S.work_rate_proxy_mean_w > 100 && S.work_rate_proxy_mean_w < 600, 'work-rate proxy plausible', S.work_rate_proxy_mean_w);
    // every documented column is present in reps/frames
    const miss = SCHEMA.reps.filter(f => !(f.key in res.reps[0])).map(f => f.key);
    const extra = Object.keys(res.reps[0]).filter(k => !SCHEMA.reps.some(f => f.key === k));
    ok(miss.length === 0 && extra.length === 0, 'reps columns == schema', 'missing ' + miss + ' extra ' + extra);
    const fm = SCHEMA.frames.filter(f => !(f.key in res.frames[0])).map(f => f.key);
    const fe = Object.keys(res.frames[0]).filter(k => !SCHEMA.frames.some(f => f.key === k));
    ok(fm.length === 0 && fe.length === 0, 'frames columns == schema', 'missing ' + fm + ' extra ' + fe);
    const nulls = SCHEMA.summary.filter(f => res.summary[f.key] === null).map(f => f.key);
    console.log('   summary fields left null:', nulls.join(', ') || '(none)');
}

console.log('--- B: half-way rule (last rep >50% up at 30 s)');
{
    const onsets = Array.from({ length: 13 }, (_, i) => 0.4 + 2.4 * i);   // last onset 29.2
    const { res } = run({ onsets, seed: 5 });
    ok(res.summary.stands_count === 13, 'counts 13 incl. half-rule stand', res.summary.stands_count);
    ok(res.summary.half_rule_applied === true, 'half_rule_applied');
}

console.log('--- C: arm use during two reps');
{
    const { res } = run({ onsets: onsetsA, armsUsedReps: [3, 4], seed: 11 });
    ok(res.summary.arm_use_reps >= 2, 'arm use detected', res.summary.arm_use_reps);
    ok(res.summary.qc_pass === false && res.summary.valid_for_norm === false, 'blocked from norms');
    ok(res.summary.norm_classification === 'Not classified', 'not classified');
}

console.log('--- D: tracking dropouts');
{
    const r1 = run({ onsets: onsetsA, gaps: [[12.0, 12.2]], dropRate: 0.05, seed: 13 }).res;
    ok(r1.summary.stands_count === 12, 'short gap (0.2 s) + 5% drops: still 12', r1.summary.stands_count);
    ok(!r1.summary.qc_flags.includes('TRACKING_GAPS'), 'short gap not flagged', r1.summary.qc_flags);
    const r2 = run({ onsets: onsetsA, gaps: [[15.0, 16.0]], seed: 13 }).res;
    ok(r2.summary.qc_flags.includes('TRACKING_GAPS'), 'long gap (1 s) flagged', r2.summary.qc_flags);
    ok(r2.reps.some(r => r.tracking_gap_flag), 'rep overlapping gap flagged');
    ok(r2.summary.qc_pass === false, 'long gap blocks qc_pass');
}

console.log('--- E: incomplete stands are not counted');
{
    const amps = onsetsA.map((_, i) => (i === 4 || i === 7) ? 0.6 : 1);
    const { res } = run({ onsets: onsetsA, amps, seed: 17 });
    ok(res.summary.stands_count === 10, 'two partial rises excluded', res.summary.stands_count);
    ok(res.summary.incomplete_attempts === 2, 'two incomplete attempts logged', res.summary.incomplete_attempts);
}

console.log('--- F: low frame rate and heavy noise degrade gracefully');
{
    const lo = run({ onsets: onsetsA, fps: 12, seed: 19 }).res;
    ok(lo.summary.qc_flags.includes('LOW_FPS'), '12 fps flagged LOW_FPS');
    const hi = run({ onsets: onsetsA, noise: 0.006, seed: 23 }).res;
    ok(hi.summary.stands_count === 12, 'heavy jitter (~4 px) still counts 12', hi.summary.stands_count);
}

console.log('--- G: manual stop and fast cadence');
{
    const m = run({ onsets: onsetsA, seed: 29 }, { elapsedS: 20, manualStop: true }).res;
    ok(m.summary.valid_for_norm === false && m.summary.qc_flags.includes('MANUAL_STOP'), 'manual stop flagged / not norm-valid');
    const fast = Array.from({ length: 22 }, (_, i) => 0.5 + 1.35 * i);
    const f = run({ onsets: fast, Ta: 0.5, Td: 0.15, Tdn: 0.5, seed: 31 }).res;
    const expected = fast.filter(o => o + 0.25 <= 30).length;
    ok(Math.abs(f.summary.stands_count - expected) <= 1, 'fast 1.35 s cadence counted within +/-1', f.summary.stands_count + ' vs ' + expected);
}

console.log('--- H: filter sanity (zero lag, unity DC, attenuation)');
{
    const fs = 30, n = 300, x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 1 * i / fs) + 0.5;
    const y = A.filtfilt(x, fs, 6, 30);
    let e = 0; for (let i = 30; i < n - 30; i++) e = Math.max(e, Math.abs(y[i] - x[i]));
    ok(e < 0.02, '1 Hz passes with <2% error and zero lag', e.toFixed(4));
    const z = new Float64Array(n); for (let i = 0; i < n; i++) z[i] = Math.sin(2 * Math.PI * 12 * i / fs);
    const zf = A.filtfilt(z, fs, 6, 30); let amp = 0; for (let i = 30; i < n - 30; i++) amp = Math.max(amp, Math.abs(zf[i]));
    ok(amp < 0.15, '12 Hz jitter attenuated', amp.toFixed(3));
}

console.log(fails ? '\n' + fails + ' TEST(S) FAILED' : '\nALL TESTS PASSED');
process.exit(fails ? 1 : 0);
