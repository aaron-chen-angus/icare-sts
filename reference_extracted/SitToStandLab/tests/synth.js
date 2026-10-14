/**
 * Synthetic sit-to-stand generator with a known ground truth (planar 3-segment body,
 * minimum-jerk motion). Produces frames in exactly the format the app records.
 */
const Ls = 0.246 * 1.7, Lt = 0.245 * 1.7, Ltr = 0.288 * 1.7;   // 1.70 m person
const W = 720, H = 1280, PXM = 600, X0 = 360, Y0 = 1130;
const RAD = Math.PI / 180;

function minJerk(u) { u = Math.max(0, Math.min(1, u)); return 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5; }

function posture(s) {
    const b = 85 * (1 - s) * RAD, a = 5 * (1 - s) * RAD, g = (5 * (1 - s) + 25 * Math.sin(Math.PI * s)) * RAD;
    const A = { x: 0, y: 0 };
    const K = { x: Ls * Math.sin(a), y: Ls * Math.cos(a) };
    const Hh = { x: K.x - Lt * Math.sin(b), y: K.y + Lt * Math.cos(b) };
    const Sh = { x: Hh.x + Ltr * Math.sin(g), y: Hh.y + Ltr * Math.cos(g) };
    return { A, K, Hh, Sh, g: g / RAD, kneeFlex: (5 * (1 - s) + 85 * (1 - s)) };
}

/** onsets: array of onset times; opts: Ta, Td, Tdn, amps[] */
function makeProfile(onsets, o) {
    const Ta = o.Ta || 0.9, Td = o.Td || 0.3, Tdn = o.Tdn || 0.9;
    return t => {
        let s = 0;
        onsets.forEach((on, i) => {
            const amp = (o.amps && o.amps[i] !== undefined) ? o.amps[i] : 1;
            let v = 0;
            if (t >= on && t < on + Ta) v = amp * minJerk((t - on) / Ta);
            else if (t >= on + Ta && t < on + Ta + Td) v = amp;
            else if (t >= on + Ta + Td && t < on + Ta + Td + Tdn) v = amp * (1 - minJerk((t - on - Ta - Td) / Tdn));
            if (v > s) s = v;
        });
        return s;
    };
}

function rng(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r()); }

function frameAt(s, rand, noise, armsUsed) {
    const P = posture(s);
    const img = new Float32Array(17 * 4), world = new Float32Array(17 * 3);
    const put = (li, x, y, vis, off) => {
        const nx = (X0 + (x + (off || 0)) * PXM) / W + gauss(rand) * noise, ny = (Y0 - y * PXM) / H + gauss(rand) * noise;
        img[li * 4] = nx; img[li * 4 + 1] = ny; img[li * 4 + 2] = 0; img[li * 4 + 3] = Math.min(1, vis + gauss(rand) * 0.01);
        world[li * 3] = (x - P.Hh.x) + gauss(rand) * 0.004; world[li * 3 + 1] = -(y - P.Hh.y) + gauss(rand) * 0.004; world[li * 3 + 2] = gauss(rand) * 0.01;
    };
    const wr = armsUsed ? { x: P.Hh.x + 0.1, y: P.Hh.y + 0.02 } : { x: P.Sh.x + 0.05, y: P.Sh.y - 0.06 };
    for (const [near, far] of [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16]]) {
        let pt;
        if (near === 1) pt = P.Sh; else if (near === 3) pt = { x: P.Sh.x + 0.1, y: P.Sh.y - 0.2 };
        else if (near === 5) pt = wr; else if (near === 7) pt = P.Hh; else if (near === 9) pt = P.K; else if (near === 11) pt = P.A;
        else if (near === 13) pt = { x: P.A.x - 0.06, y: P.A.y - 0.07 }; else pt = { x: P.A.x + 0.16, y: P.A.y - 0.07 };
        put(near, pt.x, pt.y, 0.98, 0);
        put(far, pt.x, pt.y, 0.7, 0.03);
    }
    put(0, P.Sh.x + 0.04, P.Sh.y + 0.22, 0.99, 0);
    return { img, world };
}

/**
 * opts: { onsets, Ta, Td, Tdn, amps, noise, dropRate, gaps:[[t0,t1]], armsUsedAfter (rep idx array), fps, seed, tEnd }
 */
function makeSession(opts) {
    const rand = rng(opts.seed || 7), fps = opts.fps || 30, noise = opts.noise === undefined ? 0.0015 : opts.noise;
    const prof = makeProfile(opts.onsets, opts);
    const armsAt = t => (opts.armsUsedReps || []).some(i => { const on = opts.onsets[i]; return t >= on - 0.1 && t <= on + (opts.Ta || 0.9) + 0.05; });
    const t0Ms = 10000;
    const tStart = -1.0, tEnd = opts.tEnd || 32;
    const frames = []; let attempted = 0;
    for (let t = tStart; t <= tEnd; t += 1 / fps) {
        const tj = t + (rand() - 0.5) * 0.006;
        if (t >= 0 && t <= 30) attempted++;
        if (rand() < (opts.dropRate || 0)) continue;
        if ((opts.gaps || []).some(g => tj >= g[0] && tj <= g[1])) continue;
        const f = frameAt(prof(tj), rand, noise, armsAt(tj));
        frames.push({ tMs: t0Ms + tj * 1000, img: f.img, world: f.world });
    }
    const still = (s, n) => { const out = []; for (let i = 0; i < n; i++) { const f = frameAt(s, rand, noise, false); out.push({ tMs: i * 33, img: f.img, world: f.world }); } return out; };
    return { recording: { W, H, t0Ms, attempted, frames }, standFrames: still(1, 60), seatFrames: still(0, 60), prof };
}

/** Ground truth derived numerically from the model. */
function truth(onset, o) {
    const prof = makeProfile([onset], o), hip = t => posture(prof(t)).Hh.y;
    const hs = posture(0).Hh.y, hu = posture(1).Hh.y, p = t => (hip(t) - hs) / (hu - hs);
    let tOn = null, tSt = null, vmax = 0, lean = 0;
    for (let t = onset - 0.2; t < onset + 1.5; t += 0.0005) {
        if (tOn === null && p(t) >= 0.1) tOn = t;
        if (tSt === null && p(t) >= 0.9) tSt = t;
        vmax = Math.max(vmax, (hip(t + 0.0005) - hip(t - 0.0005)) / 0.001);
        if (tOn !== null && tSt === null) lean = Math.max(lean, posture(prof(t)).g);
    }
    return { ascent: tSt - tOn, vmax, lean, rise: hip(tSt) - hip(tOn), hipStand: hu - hs };
}

module.exports = { makeSession, truth, W, H, PXM, posture };
