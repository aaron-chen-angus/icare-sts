/**
 * Sit-to-Stand Biomechanics Lab - Offline analysis (pure functions, no DOM).
 *
 * Pipeline: raw landmark frames -> per-marker gap handling & uniform resampling ->
 * zero-lag Butterworth low-pass -> pixel->metre scaling from standing calibration ->
 * hip progress p(t) -> repetition event detection -> per-rep & per-session metrics + QC.
 *
 * Works in the browser (window.STSAnalysis) and Node (module.exports) so it can be unit tested.
 */
(function (root) {
    'use strict';

    // Order of the tracked landmark array (matches CONFIG.tracked)
    const SIDE = {
        left:  { sh: 1, el: 3, wr: 5, hip: 7, kn: 9,  an: 11, heel: 13, toe: 15, oSh: 2, oWr: 6, oHip: 8 },
        right: { sh: 2, el: 4, wr: 6, hip: 8, kn: 10, an: 12, heel: 14, toe: 16, oSh: 1, oWr: 5, oHip: 7 }
    };
    const NL = 17;
    const DEG = 180 / Math.PI;

    // ---------------------------------------------------------------- small helpers
    const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
    const sd = a => {
        if (a.length < 2) return NaN;
        const m = mean(a);
        return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
    };
    const median = a => {
        if (!a.length) return NaN;
        const b = Array.from(a).sort((x, y) => x - y), m = b.length >> 1;
        return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
    };
    const fin = a => Array.from(a).filter(Number.isFinite);
    const rnd = (x, d) => (x === null || x === undefined || !Number.isFinite(x)) ? null : Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
    const slope = (xs, ys) => {
        const n = xs.length; if (n < 2) return NaN;
        const mx = mean(xs), my = mean(ys);
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
        return den === 0 ? NaN : num / den;
    };

    // ---------------------------------------------------------------- geometry (image px, y down)
    function ang2(a, b, c) {
        const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
        const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
        if (!(n > 0)) return NaN;
        return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * DEG;
    }
    function ang3(a, b, c) {
        const v1 = [a.x - b.x, a.y - b.y, a.z - b.z], v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
        const n = Math.hypot(v1[0], v1[1], v1[2]) * Math.hypot(v2[0], v2[1], v2[2]);
        if (!(n > 0)) return NaN;
        return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / n))) * DEG;
    }
    /** Sagittal-plane angles. d = +1/-1 image-x direction the participant faces. */
    function poseAngles(sh, hip, kn, an, toe, d) {
        return {
            kneeFlex: 180 - ang2(hip, kn, an),
            hipFlex: 180 - ang2(sh, hip, kn),
            trunkIncl: Math.atan2(d * (sh.x - hip.x), hip.y - sh.y) * DEG,
            shankIncl: Math.atan2(d * (kn.x - an.x), an.y - kn.y) * DEG,
            ankleAngle: toe ? ang2(kn, an, toe) : NaN
        };
    }

    // ---------------------------------------------------------------- signal processing
    /** Resample (possibly irregular, possibly sparse) samples to a uniform grid by linear interpolation. */
    function resampleOnGrid(ts, vs, ok, grid, maxGap) {
        const T = [], V = [];
        for (let i = 0; i < ts.length; i++) if (ok[i] && Number.isFinite(vs[i])) { T.push(ts[i]); V.push(vs[i]); }
        const n = T.length, y = new Float64Array(grid.length), gap = new Uint8Array(grid.length);
        if (n === 0) { y.fill(NaN); gap.fill(1); return { y, gap }; }
        let j = 0;
        for (let k = 0; k < grid.length; k++) {
            const g = grid[k];
            if (g <= T[0]) { y[k] = V[0]; gap[k] = (T[0] - g > maxGap) ? 1 : 0; }
            else if (g >= T[n - 1]) { y[k] = V[n - 1]; gap[k] = (g - T[n - 1] > maxGap) ? 1 : 0; }
            else {
                while (j < n - 2 && T[j + 1] <= g) j++;
                const t0 = T[j], t1 = T[j + 1], a = (g - t0) / (t1 - t0);
                y[k] = V[j] + a * (V[j + 1] - V[j]);
                gap[k] = (t1 - t0 > maxGap) ? 1 : 0;
            }
        }
        return { y, gap };
    }

    function biquadLP(fs, fc) {
        const K = Math.tan(Math.PI * fc / fs), s2 = Math.SQRT2, norm = 1 / (1 + s2 * K + K * K);
        return { b0: K * K * norm, b1: 2 * K * K * norm, b2: K * K * norm, a1: 2 * (K * K - 1) * norm, a2: (1 - s2 * K + K * K) * norm };
    }
    function runBiquad(x, c) {
        const y = new Float64Array(x.length);
        let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0];   // steady-state start (unity DC gain)
        for (let i = 0; i < x.length; i++) {
            const yi = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
            x2 = x1; x1 = x[i]; y2 = y1; y1 = yi; y[i] = yi;
        }
        return y;
    }
    /**
     * Zero-phase low-pass: 2nd-order Butterworth applied forward then backward.
     * fc is the desired EFFECTIVE -3 dB cutoff; the design cutoff is corrected by 1/0.802
     * (Winter, 2009) to compensate for the squared magnitude response of the two passes.
     */
    function filtfilt(x, fs, fc, padN) {
        const n = x.length;
        if (n < 12) return Float64Array.from(x);
        const fd = Math.min(fc / 0.802, 0.45 * fs);
        const c = biquadLP(fs, fd);
        const pad = Math.min(n - 1, padN || 30);
        const ext = new Float64Array(n + 2 * pad);
        for (let i = 0; i < pad; i++) {
            ext[i] = 2 * x[0] - x[pad - i];
            ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
        }
        for (let i = 0; i < n; i++) ext[pad + i] = x[i];
        const f = runBiquad(ext, c);
        f.reverse();
        const b = runBiquad(f, c);
        b.reverse();
        return b.slice(pad, pad + n);
    }
    function deriv(y, dt) {
        const n = y.length, d = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const a = y[Math.max(0, i - 1)], b = y[Math.min(n - 1, i + 1)];
            d[i] = (b - a) / (((Math.min(n - 1, i + 1)) - Math.max(0, i - 1)) * dt);
        }
        return d;
    }
    function fillNaN(a) {   // carry nearest valid value into NaNs (event detection needs a gap-free signal)
        let last = NaN;
        for (let i = 0; i < a.length; i++) { if (Number.isFinite(a[i])) last = a[i]; else if (Number.isFinite(last)) a[i] = last; }
        last = NaN;
        for (let i = a.length - 1; i >= 0; i--) { if (Number.isFinite(a[i])) last = a[i]; else if (Number.isFinite(last)) a[i] = last; }
        return a;
    }

    // ---------------------------------------------------------------- calibration
    function ok(v, x, y, minVis) { return v >= minVis && x > -0.02 && x < 1.02 && y > -0.02 && y < 1.02; }

    /** Median px coordinates & visibility of every tracked marker across frames. */
    function medianPose(frames, W, H) {
        const x = new Float64Array(NL), y = new Float64Array(NL), v = new Float64Array(NL);
        for (let li = 0; li < NL; li++) {
            const xs = [], ys = [], vs = [];
            for (const f of frames) { xs.push(f.img[li * 4] * W); ys.push(f.img[li * 4 + 1] * H); vs.push(f.img[li * 4 + 3]); }
            x[li] = median(xs); y[li] = median(ys); v[li] = median(vs);
        }
        return { x, y, v, n: frames.length };
    }
    function dominantSide(frames) {
        const score = side => {
            const S = SIDE[side]; let s = 0, n = 0;
            for (const f of frames) for (const li of [S.sh, S.hip, S.kn, S.an]) { s += f.img[li * 4 + 3]; n++; }
            return n ? s / n : 0;
        };
        return score('left') >= score('right') ? 'left' : 'right';
    }
    function describePose(med, side, d, trunkRefPx, minVis) {
        const S = SIDE[side], P = i => ({ x: med.x[i], y: med.y[i] });
        const sh = P(S.sh), hip = P(S.hip), kn = P(S.kn), an = P(S.an), toe = P(S.toe);
        const ang = poseAngles(sh, hip, kn, an, toe, d);
        const trunkLen = Math.hypot(sh.x - hip.x, sh.y - hip.y);
        const shankLen = Math.hypot(kn.x - an.x, kn.y - an.y);
        const chain = trunkLen + Math.hypot(hip.x - kn.x, hip.y - kn.y) + shankLen;
        const ref = trunkRefPx || trunkLen;
        const shMid = { x: (med.x[SIDE.left.sh] + med.x[SIDE.right.sh]) / 2, y: (med.y[SIDE.left.sh] + med.y[SIDE.right.sh]) / 2 };
        const wr = [];
        for (const i of [S.wr, S.oWr]) if (med.v[i] >= minVis) wr.push(Math.hypot(med.x[i] - shMid.x, med.y[i] - shMid.y) / ref);
        return Object.assign({}, ang, {
            shX: sh.x, shY: sh.y, hipX: hip.x, hipY: hip.y, knX: kn.x, knY: kn.y, anX: an.x, anY: an.y,
            toeX: toe.x, toeY: toe.y, heelX: med.x[S.heel], heelY: med.y[S.heel],
            trunkLenPx: trunkLen, shankLenPx: shankLen, chainPx: chain,
            armDev: wr.length ? mean(wr) : NaN
        });
    }
    /**
     * Build the calibration object from the standing and seated calibration frames.
     * Frames: [{ img: Float32Array(17*4) }]; W,H = video size in px.
     */
    function buildCalibration(standFrames, seatFrames, W, H, heightCm, cfg) {
        const minVis = cfg.signal.minVisibility;
        const side = dominantSide(standFrames.concat(seatFrames));
        const S = SIDE[side];
        const mS = medianPose(standFrames, W, H), mQ = medianPose(seatFrames, W, H);
        const d = Math.sign(mQ.x[S.kn] - mQ.x[S.hip]) || 1;
        const footS = Math.sign(mS.x[S.toe] - mS.x[S.heel]), footQ = Math.sign(mQ.x[S.toe] - mQ.x[S.heel]);
        const facingAmbiguous = (footS !== 0 && footS !== d) || (footQ !== 0 && footQ !== d);
        const stand = describePose(mS, side, d, null, minVis);
        const seat = describePose(mQ, side, d, null, minVis);
        const scale = cfg.anthropometry.segmentChainFractionOfHeight * (heightCm / 100) / stand.chainPx;
        return {
            side, facing: d, facingAmbiguous, W, H, heightCm,
            scale, stand, seat,
            hipRiseM: (seat.hipY - stand.hipY) * scale,
            shankFromVerticalDeg: Math.abs(stand.shankIncl),
            seatMedian: mQ
        };
    }
    /** Validate a calibration; returns an array of problems (empty = ok). */
    function checkCalibration(c, cfg) {
        const out = [], cc = cfg.calibration;
        if (!(c.stand.chainPx > 50)) out.push('Standing chain too short - move closer / ensure full body is visible.');
        if (c.hipRiseM < cc.hipRiseRangeM[0] || c.hipRiseM > cc.hipRiseRangeM[1]) out.push('Seated-to-standing hip rise is implausible (' + c.hipRiseM.toFixed(2) + ' m). Check height entry and that both calibrations were done correctly.');
        if (c.stand.kneeFlex > cc.standMaxKneeFlexDeg) out.push('Standing calibration knee is flexed (' + c.stand.kneeFlex.toFixed(0) + '°). Stand tall.');
        return out;
    }

    // ---------------------------------------------------------------- event detection
    const argminIn = (a, i0, i1) => { let b = i0; for (let i = i0; i <= i1; i++) if (a[i] < a[b]) b = i; return b; };
    const argmaxIn = (a, i0, i1) => { let b = i0; for (let i = i0; i <= i1; i++) if (a[i] > a[b]) b = i; return b; };
    const firstIdx = (a, i0, i1, f) => { for (let i = i0; i <= i1; i++) if (f(a[i])) return i; return -1; };
    const lastIdx = (a, i0, i1, f) => { for (let i = i1; i >= i0; i--) if (f(a[i])) return i; return -1; };
    function crossAt(t, p, i0, i1, level) {
        for (let i = Math.max(0, i0); i < i1; i++) {
            const a = p[i], b = p[i + 1];
            if ((a <= level && b >= level) || (a >= level && b <= level)) return b === a ? t[i] : t[i] + (level - a) / (b - a) * (t[i + 1] - t[i]);
        }
        return t[i1];
    }
    /** Detect stand attempts on progress p(t). Returns raw cycle objects (indices + times). */
    function detectCycles(t, p, cfg) {
        const ev = cfg.events, n = p.length, ups = [], downs = [];
        let st = 0;
        for (let i = 0; i < n; i++) {
            if (st === 0 && p[i] >= ev.stateHi) { st = 1; ups.push(i); }
            else if (st === 1 && p[i] <= ev.stateLo) { st = 0; downs.push(i); }
        }
        const reps = [];
        for (let k = 0; k < ups.length; k++) {
            const u = ups[k], prevD = k > 0 ? downs[k - 1] : 0;
            const nextD = k < downs.length ? downs[k] : null;
            const iTrB = argminIn(p, prevD, u);
            const iPk = argmaxIn(p, u, nextD !== null ? nextD : n - 1);
            const pb = p[iTrB], pk = p[iPk];
            const L10 = pb + ev.lowPct * (pk - pb), L90 = pb + ev.highPct * (pk - pb);
            let i90 = firstIdx(p, iTrB, iPk, v => v >= L90); if (i90 < 0) i90 = iPk;
            let i10 = lastIdx(p, iTrB, i90, v => v <= L10); if (i10 < 0) i10 = iTrB;
            const r = {
                iTrB, iPk, pb, pk,
                tOn: crossAt(t, p, i10, i90, L10),
                tSt: crossAt(t, p, Math.max(iTrB, i90 - 1), i90, L90),
                t50: crossAt(t, p, iTrB, iPk, cfg.protocol.halfwayProgress),
                tPk: t[iPk], tDs: null, tSeat: null, iTrA: null
            };
            if (nextD !== null) {
                const iTrA = argminIn(p, nextD, k + 1 < ups.length ? ups[k + 1] : n - 1);
                const pa = p[iTrA];
                const D90 = pa + ev.highPct * (pk - pa), D10 = pa + ev.lowPct * (pk - pa);
                const j90 = firstIdx(p, iPk, iTrA, v => v <= D90);
                if (j90 >= 0) {
                    r.tDs = crossAt(t, p, Math.max(iPk, j90 - 1), j90, D90);
                    const j10 = firstIdx(p, j90, iTrA, v => v <= D10);
                    if (j10 >= 0) r.tSeat = crossAt(t, p, Math.max(j90, j10 - 1), j10, D10);
                }
                r.iTrA = iTrA; r.pa = pa;
            }
            reps.push(r);
        }
        return reps;
    }

    // ---------------------------------------------------------------- norms
    function steadiCutoff(age, sex, cfg) {
        const tbl = cfg.steadi[sex];
        if (!tbl || !Number.isFinite(age)) return null;
        for (const [lo, hi, cut] of tbl) if (age >= lo && age <= hi) return cut;
        return null;
    }

    // ---------------------------------------------------------------- main analysis
    /**
     * args: { recording:{W,H,t0Ms,attempted,frames:[{tMs,img,world}]}, calib, participant, meta, cfg, schema }
     */
    function analyzeSession(args) {
        const { recording: rec, calib, participant: pt, meta, cfg, schema } = args;
        const T = cfg.protocol.durationS, fs = cfg.signal.resampleHz;
        const fr = rec.frames, W = rec.W, H = rec.H, S = SIDE[calib.side];
        if (!fr || fr.length < 15) return { error: 'Too few pose frames recorded (' + (fr ? fr.length : 0) + '). Check lighting and that the whole body stays in view.' };

        // --- summary object limited to documented fields
        const sum = {};
        for (const f of schema.summary) sum[f.key] = null;
        const put = (k, v) => { if (!(k in sum)) throw new Error('Undocumented summary field: ' + k); sum[k] = v; };

        const ts = fr.map(f => (f.tMs - rec.t0Ms) / 1000);
        const tStart = Math.max(ts[0], -cfg.protocol.preRollS), tEnd = ts[ts.length - 1];
        const n = Math.floor((tEnd - tStart) * fs) + 1;
        const grid = new Float64Array(n);
        for (let k = 0; k < n; k++) grid[k] = tStart + k / fs;
        const minVis = cfg.signal.minVisibility, maxGap = cfg.signal.maxGapS;
        const allOk = new Uint8Array(fr.length).fill(1);

        // --- raw masks, resample, filter every tracked marker (px)
        const PX = [], PY = [], PV = [], rawOk = [];
        let chainGap = new Uint8Array(n);
        for (let li = 0; li < NL; li++) {
            const x = new Float64Array(fr.length), y = new Float64Array(fr.length), v = new Float64Array(fr.length), o = new Uint8Array(fr.length);
            for (let i = 0; i < fr.length; i++) {
                const q = li * 4, nx = fr[i].img[q], ny = fr[i].img[q + 1];
                x[i] = nx * W; y[i] = ny * H; v[i] = fr[i].img[q + 3];
                o[i] = ok(v[i], nx, ny, minVis) ? 1 : 0;
            }
            rawOk.push(o);
            const rx = resampleOnGrid(ts, x, o, grid, maxGap), ry = resampleOnGrid(ts, y, o, grid, maxGap), rv = resampleOnGrid(ts, v, allOk, grid, maxGap);
            const hasData = Number.isFinite(rx.y[0]);
            PX.push(hasData ? filtfilt(rx.y, fs, cfg.signal.cutoffHz, cfg.signal.padSamples) : rx.y);
            PY.push(hasData ? filtfilt(ry.y, fs, cfg.signal.cutoffHz, cfg.signal.padSamples) : ry.y);
            PV.push(rv.y);
            if ([S.sh, S.hip, S.kn, S.an].includes(li)) for (let k = 0; k < n; k++) if (rx.gap[k] || ry.gap[k]) chainGap[k] = 1;
        }
        // world landmarks (dominant shoulder, hip, knee, ankle) for the 3D cross-check
        const WX = {}, WY = {}, WZ = {};
        const haveWorld = fr.every(f => f.world);
        if (haveWorld) for (const li of [S.sh, S.hip, S.kn, S.an]) {
            const wx = new Float64Array(fr.length), wy = new Float64Array(fr.length), wz = new Float64Array(fr.length);
            for (let i = 0; i < fr.length; i++) { wx[i] = fr[i].world[li * 3]; wy[i] = fr[i].world[li * 3 + 1]; wz[i] = fr[i].world[li * 3 + 2]; }
            const f = (a) => { const r = resampleOnGrid(ts, a, rawOk[li], grid, maxGap); return Number.isFinite(r.y[0]) ? filtfilt(r.y, fs, cfg.signal.cutoffHz, cfg.signal.padSamples) : r.y; };
            WX[li] = f(wx); WY[li] = f(wy); WZ[li] = f(wz);
        }

        // --- derived signals
        const d = calib.facing, sc = calib.scale, seatY = calib.seat.hipY, rise = calib.seat.hipY - calib.stand.hipY;
        const trunkRef = calib.seat.trunkLenPx;
        const A = () => new Float64Array(n);
        const hipUp = A(), prog = A(), kneeF = A(), hipF = A(), trunkI = A(), shankI = A(), ankA = A(), kn3 = A(), hip3 = A(), armDev = A(), obliq = A(), chainPx = A();
        for (let k = 0; k < n; k++) {
            const sh = { x: PX[S.sh][k], y: PY[S.sh][k] }, hip = { x: PX[S.hip][k], y: PY[S.hip][k] },
                kn = { x: PX[S.kn][k], y: PY[S.kn][k] }, an = { x: PX[S.an][k], y: PY[S.an][k] }, toe = { x: PX[S.toe][k], y: PY[S.toe][k] };
            hipUp[k] = (seatY - hip.y) * sc;
            prog[k] = (seatY - hip.y) / rise;
            const a = poseAngles(sh, hip, kn, an, toe, d);
            kneeF[k] = a.kneeFlex; hipF[k] = a.hipFlex; trunkI[k] = a.trunkIncl; shankI[k] = a.shankIncl; ankA[k] = a.ankleAngle;
            if (haveWorld) {
                const w = li => ({ x: WX[li][k], y: WY[li][k], z: WZ[li][k] });
                kn3[k] = 180 - ang3(w(S.hip), w(S.kn), w(S.an));
                hip3[k] = 180 - ang3(w(S.sh), w(S.hip), w(S.kn));
            } else { kn3[k] = NaN; hip3[k] = NaN; }
            chainPx[k] = Math.hypot(sh.x - hip.x, sh.y - hip.y) + Math.hypot(hip.x - kn.x, hip.y - kn.y) + Math.hypot(kn.x - an.x, kn.y - an.y);
            obliq[k] = Math.abs(PX[SIDE.left.hip][k] - PX[SIDE.right.hip][k]) / trunkRef;
            // arm deviation
            const shm = { x: (PX[1][k] + PX[2][k]) / 2, y: (PY[1][k] + PY[2][k]) / 2 }, ds = [];
            for (const li of [S.wr, S.oWr]) if (PV[li][k] >= minVis) ds.push(Math.hypot(PX[li][k] - shm.x, PY[li][k] - shm.y) / trunkRef);
            armDev[k] = ds.length ? mean(ds) : NaN;
        }
        const dt = 1 / fs;
        const hipVel = deriv(hipUp, dt), kneeVel = deriv(kneeF, dt), hipFVel = deriv(hipF, dt);
        const progFilled = fillNaN(Float64Array.from(prog));

        // --- events
        const cyc = detectCycles(grid, progFilled, cfg);
        const idxOf = t => Math.max(0, Math.min(n - 1, Math.round((t - tStart) * fs)));
        const valAt = (arr, t) => {
            const f = (t - tStart) * fs, i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1), a = f - i0;
            return arr[i0] + a * (arr[i1] - arr[i0]);
        };
        const medIn = (arr, i0, i1) => median(fin(Array.prototype.slice.call(arr, Math.min(i0, i1), Math.max(i0, i1) + 1)));
        const maxIn = (arr, i0, i1) => { let m = -Infinity; for (let i = i0; i <= i1; i++) if (Number.isFinite(arr[i]) && arr[i] > m) m = arr[i]; return m === -Infinity ? NaN : m; };
        const minIn = (arr, i0, i1) => { let m = Infinity; for (let i = i0; i <= i1; i++) if (Number.isFinite(arr[i]) && arr[i] < m) m = arr[i]; return m === Infinity ? NaN : m; };

        // pre-roll sanity
        const flags = [];
        const pre = []; for (let k = 0; k < n; k++) if (grid[k] < 0) pre.push(progFilled[k]);
        if (pre.length >= 9 && median(pre) > 0.2) flags.push('NOT_SEATED_AT_START');

        const standKneeCal = calib.stand.kneeFlex;
        const reps = [];
        let movedBeforeGo = false;
        for (const c of cyc) {
            if (c.t50 < 0) { movedBeforeGo = true; continue; }     // movement began before Go
            if (c.t50 > T) continue;                              // belongs to the post-test tail
            const iOn = idxOf(c.tOn), iSt = idxOf(c.tSt), iSeat = c.tSeat !== null ? idxOf(c.tSeat) : null, iDs = c.tDs !== null ? idxOf(c.tDs) : null;
            const sw1 = iDs !== null && iDs > iSt ? iDs : Math.min(n - 1, iSt + 3);
            const kneeStand = medIn(kneeF, iSt, sw1);
            const hipFStand = medIn(hipF, iSt, sw1);
            const trunkStand = medIn(trunkI, iSt, sw1);
            const fullHip = c.pk >= cfg.events.fullStandProgress;
            const fullKnee = Number.isFinite(kneeStand) ? kneeStand <= standKneeCal + cfg.events.kneeExtToleranceDeg : false;
            const halfRule = c.tPk > T || c.tSt > T;
            const counted = (fullHip && fullKnee) || c.tPk > T;
            const hUpOn = valAt(hipUp, c.tOn), hUpSt = valAt(hipUp, c.tSt);
            const ascT = c.tSt - c.tOn;
            // peak velocities over the whole rise window
            const iVelPk = argmaxIn(hipVel, c.iTrB, c.iPk);
            const pdv = c.iTrA !== null ? -minIn(hipVel, c.iPk, c.iTrA) : NaN;
            // arm use
            const a0 = Math.max(0, iOn - Math.round(0.2 * fs));
            let armFlag = 'unavailable', armMax = NaN, run = 0, best = 0;
            const base = calib.seat.armDev;
            if (Number.isFinite(base)) {
                let any = false;
                for (let i = a0; i <= iSt; i++) {
                    if (!Number.isFinite(armDev[i])) { run = 0; continue; }
                    any = true;
                    const dev = armDev[i] - base;
                    if (!(dev <= armMax)) armMax = dev;
                    if (dev > cfg.arms.deviationThreshold) { run++; if (run > best) best = run; } else run = 0;
                }
                if (any) armFlag = best / fs >= cfg.arms.minDurationS ? 'suspected' : 'no';
            }
            let gapFlag = false;
            for (let i = iOn; i <= (iSeat !== null ? iSeat : iSt); i++) if (chainGap[i]) { gapFlag = true; break; }
            const kneeOn = valAt(kneeF, c.tOn);
            const ankRange = maxIn(ankA, iOn, iSt) - minIn(ankA, iOn, iSt);
            const mass = pt.massKg;
            reps.push({
                rep_index: reps.length + 1, stand_number: null, counted, counted_by_half_rule: counted && halfRule,
                full_stand_hip: fullHip, full_stand_knee: fullKnee,
                t_onset_s: rnd(c.tOn, 3), t_half_s: rnd(c.t50, 3), t_standing_s: rnd(c.tSt, 3),
                t_descent_start_s: rnd(c.tDs, 3), t_seat_contact_s: rnd(c.tSeat, 3),
                ascent_time_s: rnd(ascT, 3),
                standing_dwell_s: rnd(c.tDs !== null ? c.tDs - c.tSt : NaN, 3),
                descent_time_s: rnd(c.tSeat !== null && c.tDs !== null ? c.tSeat - c.tDs : NaN, 3),
                seated_dwell_s: null, cycle_time_s: null,
                peak_progress: rnd(c.pk, 3), hip_rise_m: rnd(hUpSt - hUpOn, 4),
                peak_ascent_velocity_m_s: rnd(hipVel[iVelPk], 3), time_to_peak_velocity_s: rnd(grid[iVelPk] - c.tOn, 3),
                ascent_mean_velocity_m_s: rnd((hUpSt - hUpOn) / ascT, 3), peak_descent_velocity_m_s: rnd(pdv, 3),
                work_rate_proxy_w: Number.isFinite(mass) && mass > 0 ? rnd(mass * 9.81 * (hUpSt - hUpOn) / ascT, 1) : null,
                knee_flex_onset_deg: rnd(kneeOn, 2), knee_flex_standing_deg: rnd(kneeStand, 2), knee_rom_deg: rnd(kneeOn - kneeStand, 2),
                knee_ext_peak_velocity_deg_s: rnd(-minIn(kneeVel, iOn, iSt), 1),
                hip_flex_onset_deg: rnd(valAt(hipF, c.tOn), 2), hip_flex_standing_deg: rnd(hipFStand, 2),
                hip_ext_peak_velocity_deg_s: rnd(-minIn(hipFVel, iOn, iSt), 1),
                trunk_incl_onset_deg: rnd(valAt(trunkI, c.tOn), 2), trunk_lean_peak_deg: rnd(maxIn(trunkI, iOn, iSt), 2),
                trunk_incl_standing_deg: rnd(trunkStand, 2), shank_incl_peak_deg: rnd(maxIn(shankI, iOn, iSt), 2),
                ankle_angle_range_deg: rnd(ankRange, 2),
                arm_dev_max: rnd(armMax, 3), arm_use_flag: armFlag, tracking_gap_flag: gapFlag,
                _c: c
            });
        }
        if (movedBeforeGo) flags.push('MOVED_BEFORE_GO');
        // timing relations across reps
        let sn = 0;
        for (let i = 0; i < reps.length; i++) {
            if (reps[i].counted) reps[i].stand_number = ++sn;
            const nx = reps[i + 1];
            if (nx) {
                if (reps[i]._c.tSeat !== null) reps[i].seated_dwell_s = rnd(nx._c.tOn - reps[i]._c.tSeat, 3);
            }
        }
        const counted = reps.filter(r => r.counted);
        for (let i = 0; i < counted.length - 1; i++) counted[i].cycle_time_s = rnd(counted[i + 1]._c.tOn - counted[i]._c.tOn, 3);

        // --- QC over the test window [0, min(T, elapsed)]
        const dur = Math.min(T, meta.elapsedS);
        const inWin = [];
        for (let i = 0; i < fr.length; i++) if (ts[i] >= 0 && ts[i] <= dur) inWin.push(i);
        const chainIdx = [S.sh, S.hip, S.kn, S.an];
        let validN = 0, lastOk = 0, longest = 0;
        const chainVis = [];
        for (const i of inWin) {
            const all = chainIdx.every(li => rawOk[li][i]);
            if (all) { validN++; longest = Math.max(longest, ts[i] - lastOk); lastOk = ts[i]; }
            chainVis.push(mean(chainIdx.map(li => fr[i].img[li * 4 + 3])));
        }
        longest = Math.max(longest, dur - lastOk);
        const attempted = Math.max(rec.attempted || inWin.length, inWin.length);
        const effFs = dur > 0 ? attempted / dur : NaN;
        const validPct = attempted ? 100 * validN / attempted : NaN;
        const gi0 = idxOf(0), gi1 = idxOf(dur);
        let imp = 0; for (let k = gi0; k <= gi1; k++) imp += chainGap[k];
        const impPct = 100 * imp / Math.max(1, gi1 - gi0 + 1);
        const obMed = medIn(obliq, gi0, gi1);
        const chainMed = medIn(chainPx, gi0, gi1);
        const scaleDiff = 100 * (chainMed / calib.stand.chainPx - 1);
        const k2 = []; for (let k = gi0; k <= gi1; k++) if (Number.isFinite(kneeF[k]) && Number.isFinite(kn3[k])) k2.push(Math.abs(kneeF[k] - kn3[k]));
        const kneeDiff = k2.length ? mean(k2) : NaN;
        const ankShift = Math.abs(medIn(PY[S.an], gi0, gi1) - calib.stand.anY) / calib.stand.shankLenPx;

        if (effFs < cfg.qc.minEffectiveFps) flags.push('LOW_FPS');
        if (validPct < cfg.qc.minValidFramePct) flags.push('LOW_VALID_FRAMES');
        if (impPct > cfg.qc.maxImputedPct || longest > maxGap * 2) flags.push('TRACKING_GAPS');
        if (obMed > cfg.qc.maxObliquity) flags.push('OBLIQUE_VIEW');
        if (Math.abs(scaleDiff) > cfg.qc.maxScaleDiffPct) flags.push('SCALE_INCONSISTENT');
        if (ankShift > cfg.qc.maxAnkleShiftShankFrac) flags.push('CAMERA_OR_FEET_SHIFT');
        if (calib.shankFromVerticalDeg > cfg.qc.maxShankVerticalDeg) flags.push('CAMERA_TILT');
        if (calib.stand.kneeFlex > cfg.calibration.standMaxKneeFlexDeg) flags.push('STANDING_CAL_KNEE_FLEXED');
        if (calib.hipRiseM < cfg.calibration.hipRiseRangeM[0] || calib.hipRiseM > cfg.calibration.hipRiseRangeM[1]) flags.push('HIP_RISE_IMPLAUSIBLE');
        if (Number.isFinite(kneeDiff) && kneeDiff > cfg.qc.maxKnee2D3DDiffDeg) flags.push('KNEE_2D_3D_DISAGREE');
        if (calib.facingAmbiguous) flags.push('FACING_AMBIGUOUS');
        const armReps = counted.filter(r => r.arm_use_flag === 'suspected').length;
        if (armReps > 0) flags.push('ARM_USE_SUSPECTED');
        if (meta.manualStop) flags.push('MANUAL_STOP');
        if (counted.length === 0) flags.push('NO_REPS_DETECTED');
        const qcPass = !flags.some(f => cfg.qc.blocking.includes(f));

        // --- summary
        const col = (k) => fin(counted.map(r => r[k]));
        const m = (k) => rnd(mean(col(k)), 3), s = (k) => rnd(sd(col(k)), 3);
        const cyc_ = col('cycle_time_s');
        put('session_id', meta.sessionId); put('timestamp_utc', meta.timestampUtc); put('utc_offset_min', meta.utcOffsetMin);
        put('app_version', cfg.app.version); put('analysis_version', cfg.app.analysisVersion); put('schema_version', cfg.app.schemaVersion);
        put('participant_id', pt.id); put('age_years', pt.age); put('sex', pt.sex); put('height_cm', pt.heightCm);
        put('body_mass_kg', Number.isFinite(pt.massKg) ? pt.massKg : null); put('chair_seat_height_cm', pt.chairCm);
        put('site', pt.site || ''); put('operator_notes', pt.notes || '');
        put('pose_model', meta.poseModel); put('pose_delegate', meta.delegate); put('camera_facing', meta.cameraFacing);
        put('video_width_px', W); put('video_height_px', H); put('user_agent', (meta.userAgent || '').slice(0, 200));
        put('planned_duration_s', T); put('test_duration_s', rnd(dur, 2)); put('manual_stop', !!meta.manualStop);
        put('arms_crossed_confirmed', !!pt.armsCrossed); put('filter_cutoff_hz', cfg.signal.cutoffHz); put('resample_hz', fs);
        put('stands_count', counted.length); put('live_count', Number.isFinite(meta.liveCount) ? meta.liveCount : null);
        put('count_difference', Number.isFinite(meta.liveCount) ? counted.length - meta.liveCount : null);
        put('half_rule_applied', counted.some(r => r.counted_by_half_rule));
        put('incomplete_attempts', reps.filter(r => !r.counted).length);
        put('stands_first_half', counted.filter(r => r.t_half_s <= T / 2).length);
        put('stands_second_half', counted.filter(r => r.t_half_s > T / 2).length);
        const cut = steadiCutoff(pt.age, pt.sex, cfg);
        const validNorm = qcPass && dur >= T - 0.01 && !!pt.armsCrossed && cut !== null;
        put('norm_reference', cfg.steadi.reference); put('norm_cutoff_below_average', cut);
        put('norm_classification', validNorm ? (counted.length < cut ? 'Below average' : 'Average or above') : 'Not classified');
        put('time_to_first_stand_s', counted.length ? counted[0].t_standing_s : null);
        put('cycle_time_mean_s', rnd(mean(cyc_), 3)); put('cycle_time_sd_s', rnd(sd(cyc_), 3));
        put('cycle_time_cv_pct', cyc_.length > 1 ? rnd(sd(cyc_) / mean(cyc_) * 100, 2) : null);
        put('cycle_time_min_s', cyc_.length ? rnd(Math.min(...cyc_), 3) : null); put('cycle_time_max_s', cyc_.length ? rnd(Math.max(...cyc_), 3) : null);
        const cycReps = counted.filter(r => Number.isFinite(r.cycle_time_s));
        put('cycle_time_slope_s_per_rep', cycReps.length >= 4 ? rnd(slope(cycReps.map(r => r.stand_number), cycReps.map(r => r.cycle_time_s)), 4) : null);
        const third = Math.floor(counted.length / 3);
        const thirds = (key) => {
            if (counted.length < 6) return null;
            const a = fin(counted.slice(0, third).map(r => r[key])), b = fin(counted.slice(-third).map(r => r[key]));
            return a.length && b.length ? (mean(b) - mean(a)) / mean(a) * 100 : null;
        };
        put('cycle_time_change_pct', rnd(thirds('cycle_time_s'), 2));
        put('ascent_time_mean_s', m('ascent_time_s')); put('ascent_time_sd_s', s('ascent_time_s'));
        put('standing_dwell_mean_s', m('standing_dwell_s')); put('descent_time_mean_s', m('descent_time_s')); put('descent_time_sd_s', s('descent_time_s'));
        put('seated_dwell_mean_s', m('seated_dwell_s'));
        put('hip_rise_mean_m', rnd(mean(col('hip_rise_m')), 4));
        put('peak_ascent_velocity_mean_m_s', m('peak_ascent_velocity_m_s')); put('peak_ascent_velocity_sd_m_s', s('peak_ascent_velocity_m_s'));
        put('peak_ascent_velocity_max_m_s', col('peak_ascent_velocity_m_s').length ? rnd(Math.max(...col('peak_ascent_velocity_m_s')), 3) : null);
        put('ascent_mean_velocity_mean_m_s', m('ascent_mean_velocity_m_s')); put('peak_descent_velocity_mean_m_s', m('peak_descent_velocity_m_s'));
        put('ascent_velocity_change_pct', rnd(thirds('peak_ascent_velocity_m_s'), 2));
        put('work_rate_proxy_mean_w', col('work_rate_proxy_w').length ? rnd(mean(col('work_rate_proxy_w')), 1) : null);
        put('knee_flex_seated_mean_deg', rnd(mean(col('knee_flex_onset_deg')), 2)); put('knee_flex_standing_mean_deg', rnd(mean(col('knee_flex_standing_deg')), 2));
        put('knee_rom_mean_deg', rnd(mean(col('knee_rom_deg')), 2)); put('knee_ext_peak_velocity_mean_deg_s', rnd(mean(col('knee_ext_peak_velocity_deg_s')), 1));
        put('hip_flex_seated_mean_deg', rnd(mean(col('hip_flex_onset_deg')), 2)); put('hip_flex_standing_mean_deg', rnd(mean(col('hip_flex_standing_deg')), 2));
        put('hip_ext_peak_velocity_mean_deg_s', rnd(mean(col('hip_ext_peak_velocity_deg_s')), 1));
        put('trunk_lean_peak_mean_deg', rnd(mean(col('trunk_lean_peak_deg')), 2));
        put('trunk_lean_peak_max_deg', col('trunk_lean_peak_deg').length ? rnd(Math.max(...col('trunk_lean_peak_deg')), 2) : null);
        put('trunk_incl_standing_mean_deg', rnd(mean(col('trunk_incl_standing_deg')), 2)); put('shank_incl_peak_mean_deg', rnd(mean(col('shank_incl_peak_deg')), 2));
        put('ankle_angle_range_mean_deg', rnd(mean(col('ankle_angle_range_deg')), 2));
        put('dominant_side', calib.side); put('facing_direction', calib.facing > 0 ? 'right' : 'left');
        put('scale_m_per_px', rnd(sc, 6)); put('scale_check_diff_pct', rnd(scaleDiff, 2)); put('calib_chain_px', rnd(calib.stand.chainPx, 1));
        put('calib_hip_rise_m', rnd(calib.hipRiseM, 4)); put('calib_standing_knee_flex_deg', rnd(calib.stand.kneeFlex, 2));
        put('calib_seated_knee_flex_deg', rnd(calib.seat.kneeFlex, 2)); put('calib_standing_trunk_incl_deg', rnd(calib.stand.trunkIncl, 2));
        put('calib_shank_from_vertical_deg', rnd(calib.shankFromVerticalDeg, 2)); put('calib_seated_arm_dev', rnd(calib.seat.armDev, 3));
        put('effective_fs_hz', rnd(effFs, 1)); put('valid_frame_pct', rnd(validPct, 1)); put('imputed_sample_pct', rnd(impPct, 1));
        put('longest_gap_s', rnd(longest, 3)); put('median_chain_visibility', rnd(median(chainVis), 3));
        put('view_obliquity_median', rnd(obMed, 3)); put('knee_2d_3d_diff_deg', rnd(kneeDiff, 2)); put('ankle_shift_shank_frac', rnd(ankShift, 3));
        put('arm_use_reps', armReps); put('qc_flags', flags.join('; ')); put('qc_pass', qcPass); put('valid_for_norm', validNorm);

        // --- phase labels and analysed time series
        const phase = new Array(n).fill('SEATED');
        for (const r of reps) {
            const c = r._c, lab = (t0, t1, name) => { if (t0 === null || t1 === null) return; for (let k = idxOf(t0); k <= idxOf(t1); k++) if (grid[k] >= t0 && grid[k] <= t1) phase[k] = name; };
            lab(c.tOn, c.tSt, 'ASCENT'); lab(c.tSt, c.tDs, 'STANDING'); lab(c.tDs, c.tSeat, 'DESCENT');
            if (c.tDs === null) lab(c.tSt, tEnd, 'STANDING');
        }
        const frames = [];
        for (let k = 0; k < n; k++) frames.push({
            t_s: rnd(grid[k], 3), phase: phase[k], tracking_gap: chainGap[k], progress: rnd(prog[k], 4), hip_up_m: rnd(hipUp[k], 4),
            hip_vel_m_s: rnd(hipVel[k], 3), knee_flex_deg: rnd(kneeF[k], 2), knee_vel_deg_s: rnd(kneeVel[k], 1), hip_flex_deg: rnd(hipF[k], 2),
            hip_flex_vel_deg_s: rnd(hipFVel[k], 1), trunk_incl_deg: rnd(trunkI[k], 2), shank_incl_deg: rnd(shankI[k], 2), ankle_angle_deg: rnd(ankA[k], 2),
            knee_flex_3d_deg: rnd(kn3[k], 2), hip_flex_3d_deg: rnd(hip3[k], 2), arm_dev: rnd(armDev[k], 3), obliquity: rnd(obliq[k], 3),
            sh_x_px: rnd(PX[S.sh][k], 1), sh_y_px: rnd(PY[S.sh][k], 1), hip_x_px: rnd(PX[S.hip][k], 1), hip_y_px: rnd(PY[S.hip][k], 1),
            knee_x_px: rnd(PX[S.kn][k], 1), knee_y_px: rnd(PY[S.kn][k], 1), ankle_x_px: rnd(PX[S.an][k], 1), ankle_y_px: rnd(PY[S.an][k], 1)
        });
        const outReps = reps.map(r => { const o = Object.assign({ session_id: meta.sessionId }, r); delete o._c; return o; });
        const events = reps.map(r => ({ n: r.rep_index, counted: r.counted, onset: r._c.tOn, half: r._c.t50, standing: r._c.tSt, descent: r._c.tDs, seat: r._c.tSeat }));
        for (const f of frames) f.session_id = meta.sessionId;
        return {
            summary: sum, reps: outReps, frames, events, flags,
            series: { t: Array.from(grid), progress: Array.from(prog), hipUp: Array.from(hipUp), hipVel: Array.from(hipVel), kneeFlex: Array.from(kneeF), hipFlex: Array.from(hipF), trunkIncl: Array.from(trunkI) }
        };
    }

    const api = {
        analyzeSession, buildCalibration, checkCalibration, detectCycles, filtfilt, resampleOnGrid, steadiCutoff,
        poseAngles, ang2, ang3, medianPose, dominantSide, describePose, deriv, SIDE, NL
    };
    root.STSAnalysis = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
