/**
 * Sit-to-Stand Biomechanics Lab - Pose engine
 * MediaPipe Pose Landmarker (browser, on-device), camera, frame capture and skeleton overlay.
 * Emits frames in the exact layout the analysis expects:
 *   { tMs, img: Float32Array(17*4) [x,y,z,visibility normalised], world: Float32Array(17*3) [m] }
 */
class PoseEngine {
    constructor() {
        this.landmarker = null;
        this.video = null; this.canvas = null; this.ctx = null;
        this.running = false;
        this.onFrame = null;
        this.delegate = null; this.model = null;
        this.mirror = false;
        this.showLabels = true; this.showAll = false;
        this.overlay = null;          // { lines:[{y,label,color}], angles:{...} }
        this.side = null;             // dominant side for highlighting
        this._lastTs = 0; this._rvfc = false; this._lastVT = -1;
        this.lastFull = null;
        this.fpsEMA = 0; this._lastFrameWall = 0;
    }

    async initialize(modelKey, onStatus) {
        const say = m => onStatus && onStatus(m);
        if (this.landmarker && this.model === modelKey) return true;
        say('Loading pose model…');
        const mod = await import(CONFIG.pose.bundleUrl);
        const { PoseLandmarker, FilesetResolver } = mod;
        const fileset = await FilesetResolver.forVisionTasks(CONFIG.pose.wasmUrl);
        const opts = delegate => ({
            baseOptions: { modelAssetPath: CONFIG.pose.models[modelKey], delegate },
            runningMode: 'VIDEO', numPoses: CONFIG.pose.numPoses,
            minPoseDetectionConfidence: CONFIG.pose.detectionConfidence,
            minPosePresenceConfidence: CONFIG.pose.presenceConfidence,
            minTrackingConfidence: CONFIG.pose.trackingConfidence
        });
        try { this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); this.delegate = 'GPU'; }
        catch (e) { console.warn('GPU delegate failed, using CPU', e); this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); this.delegate = 'CPU'; }
        this.model = modelKey;
        say('Pose model ready (' + modelKey + ', ' + this.delegate + ')');
        return true;
    }

    async startCamera(video, canvas, facing) {
        this.video = video; this.canvas = canvas; this.ctx = canvas.getContext('2d');
        const portrait = window.innerHeight >= window.innerWidth;
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing, width: { ideal: portrait ? 720 : 1280 }, height: { ideal: portrait ? 1280 : 720 }, frameRate: { ideal: 30 } },
            audio: false
        });
        this.stream = stream;
        video.srcObject = stream;
        await new Promise(res => { video.onloadedmetadata = () => { video.play(); res(); }; });
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        this.mirror = facing === 'user';
        this.running = true; this._lastTs = 0;
        this._rvfc = typeof video.requestVideoFrameCallback === 'function';
        this._schedule();
    }

    stop() {
        this.running = false;
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
        if (this.video) this.video.srcObject = null;
    }

    _schedule() {
        if (!this.running) return;
        if (this._rvfc) this.video.requestVideoFrameCallback((now, meta) => this._tick(meta));
        else requestAnimationFrame(() => this._tick(null));
    }

    _tick(meta) {
        if (!this.running) return;
        const v = this.video;
        if (!this._rvfc && v.currentTime === this._lastVT) { this._schedule(); return; }
        this._lastVT = v.currentTime;
        if (v.readyState < 2) { this._schedule(); return; }
        let tMs = meta ? (meta.captureTime != null ? meta.captureTime : (meta.presentationTime != null ? meta.presentationTime : performance.now())) : performance.now();
        if (tMs <= this._lastTs) tMs = this._lastTs + 1;
        this._lastTs = tMs;
        const wall = performance.now();
        if (this._lastFrameWall) { const f = 1000 / Math.max(1, wall - this._lastFrameWall); this.fpsEMA = this.fpsEMA ? 0.9 * this.fpsEMA + 0.1 * f : f; }
        this._lastFrameWall = wall;
        let res = null;
        try { res = this.landmarker.detectForVideo(v, tMs); } catch (e) { console.warn('detect error', e); }
        let frame = null, full = null;
        if (res && res.landmarks && res.landmarks.length) {
            full = res.landmarks[0];
            const wl = res.worldLandmarks && res.worldLandmarks[0];
            const img = new Float32Array(CONFIG.tracked.length * 4), world = new Float32Array(CONFIG.tracked.length * 3);
            CONFIG.tracked.forEach((m, i) => {
                const l = full[m.idx];
                img[i * 4] = l.x; img[i * 4 + 1] = l.y; img[i * 4 + 2] = l.z; img[i * 4 + 3] = l.visibility == null ? 0 : l.visibility;
                if (wl) { const w = wl[m.idx]; world[i * 3] = w.x; world[i * 3 + 1] = w.y; world[i * 3 + 2] = w.z; }
            });
            frame = { tMs, img, world: wl ? world : null };
        }
        this.lastFull = full;
        this.draw(full);
        if (this.onFrame) { try { this.onFrame(frame, tMs); } catch (e) { console.error(e); } }
        this._schedule();
    }

    // ------------------------------------------------------------ overlay
    _text(str, x, y, color, size) {
        const c = this.ctx;
        c.save();
        c.font = '600 ' + size + 'px -apple-system, Segoe UI, Roboto, sans-serif';
        c.textBaseline = 'middle';
        c.translate(x, y);
        if (this.mirror) c.scale(-1, 1);
        c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.strokeText(str, 0, 0);
        c.fillStyle = color; c.fillText(str, 0, 0);
        c.restore();
    }

    draw(lm) {
        const c = this.ctx, w = this.canvas.width, h = this.canvas.height;
        c.clearRect(0, 0, w, h);
        const base = Math.max(w, h) / 1000;
        // calibration reference lines (progress 0 / 0.5 / 1)
        if (this.overlay && this.overlay.lines) {
            c.save(); c.setLineDash([14 * base, 10 * base]); c.lineWidth = 2 * base;
            for (const L of this.overlay.lines) {
                c.strokeStyle = L.color; c.beginPath(); c.moveTo(0, L.y); c.lineTo(w, L.y); c.stroke();
                this._text(L.label, w * (this.mirror ? 0.97 : 0.03), L.y - 14 * base, L.color, 18 * base);
            }
            c.restore();
        }
        if (!lm) return;
        const sideIdx = this.side === 'right' ? 'r' : 'l';
        const byKey = {}; CONFIG.tracked.forEach(m => { byKey[m.key] = m; });
        const conn = [['l_sh', 'r_sh'], ['l_sh', 'l_el'], ['l_el', 'l_wr'], ['r_sh', 'r_el'], ['r_el', 'r_wr'], ['l_sh', 'l_hip'], ['r_sh', 'r_hip'], ['l_hip', 'r_hip'],
            ['l_hip', 'l_kn'], ['l_kn', 'l_an'], ['r_hip', 'r_kn'], ['r_kn', 'r_an'], ['l_an', 'l_heel'], ['l_heel', 'l_toe'], ['l_an', 'l_toe'], ['r_an', 'r_heel'], ['r_heel', 'r_toe'], ['r_an', 'r_toe']];
        c.lineCap = 'round';
        for (const [a, b] of conn) {
            const A = lm[byKey[a].idx], B = lm[byKey[b].idx];
            if (!A || !B) continue;
            const near = a[0] === sideIdx || b[0] === sideIdx;
            const vis = Math.min(A.visibility || 0, B.visibility || 0);
            c.strokeStyle = near ? 'rgba(0,212,212,' + (vis > 0.5 ? 0.95 : 0.35) + ')' : 'rgba(160,168,192,' + (vis > 0.5 ? 0.55 : 0.2) + ')';
            c.lineWidth = (near ? 5 : 3) * base;
            c.beginPath(); c.moveTo(A.x * w, A.y * h); c.lineTo(B.x * w, B.y * h); c.stroke();
        }
        if (this.showAll) {
            c.fillStyle = 'rgba(255,255,255,0.35)';
            for (const l of lm) { c.beginPath(); c.arc(l.x * w, l.y * h, 2.5 * base, 0, 6.2832); c.fill(); }
        }
        for (const m of CONFIG.tracked) {
            const l = lm[m.idx]; if (!l) continue;
            const good = (l.visibility || 0) >= CONFIG.signal.minVisibility;
            const near = m.key[0] === sideIdx || m.key === 'nose';
            const r = (near ? 8 : 6) * base;
            c.beginPath(); c.arc(l.x * w, l.y * h, r, 0, 6.2832);
            if (good) { c.fillStyle = near ? 'rgba(255,107,87,0.95)' : 'rgba(255,170,150,0.7)'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2 * base; c.stroke(); }
            else { c.strokeStyle = 'rgba(255,200,0,0.9)'; c.lineWidth = 3 * base; c.stroke(); }
            if (this.showLabels && (near || m.key === 'nose')) this._text(m.key.replace('l_', '').replace('r_', '').toUpperCase() + ' ' + Math.round((l.visibility || 0) * 100), l.x * w + 14 * base * (this.mirror ? -1 : 1), l.y * h, good ? '#ffffff' : '#ffc800', 15 * base);
        }
        // live angle callouts at joints
        const an = this.overlay && this.overlay.angles;
        if (an && this.side) {
            const P = k => lm[byKey[sideIdx + '_' + k].idx];
            const put = (pt, txt, col) => { if (pt) this._text(txt, pt.x * w - 90 * base * (this.mirror ? -1 : 1), pt.y * h, col, 20 * base); };
            if (Number.isFinite(an.knee)) put(P('kn'), 'KNEE ' + an.knee.toFixed(0) + '°', '#4cdf7c');
            if (Number.isFinite(an.hip)) put(P('hip'), 'HIP ' + an.hip.toFixed(0) + '°', '#ffd700');
            if (Number.isFinite(an.trunk)) put(P('sh'), 'TRUNK ' + an.trunk.toFixed(0) + '°', '#7fd4ff');
        }
    }
}
