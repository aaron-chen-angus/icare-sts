/**
 * Sit-to-Stand Biomechanics Lab - application controller.
 * Flow: home -> setup -> [position -> calibrate standing -> calibrate seated -> ready -> countdown -> 30 s test]
 *       -> offline analysis -> results (charts, per-rep table, QC) -> export / Google Sheets.
 */
(function () {
    'use strict';
    const A = STSAnalysis, T = CONFIG.protocol.durationS;
    const app = document.getElementById('app');
    const engine = new PoseEngine();
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v, d, u) => (v === null || v === undefined || !Number.isFinite(v)) ? '–' : v.toFixed(d) + (u ? '<small> ' + u + '</small>' : '');

    const S = { participant: null, step: null, ring: [], cap: null, standFrames: null, calib: null, rec: null, t0: 0, tFrames: [], attempted: 0,
        liveCount: 0, liveState: 'seated', pEma: null, side: null, lastFrame: null, timer: null, cdTimer: null, result: null, audio: null, manualStop: false, sheetsStatus: '' };

    const FLAG_INFO = {
        LOW_FPS: 'Pose detection ran below 15 frames/s: timing precision is reduced. Use a faster device or the lite model.',
        LOW_VALID_FRAMES: 'Fewer than 90 % of frames had shoulder, hip, knee and ankle all detected. Improve lighting/clothing contrast and framing.',
        TRACKING_GAPS: 'Tracking dropped out for a long period; affected reps are flagged and bridged by interpolation.',
        OBLIQUE_VIEW: 'The camera was not perpendicular to the participant (hips appear separated). Angles are less accurate - re-position side-on.',
        SCALE_INCONSISTENT: 'Body chain length during the test differs >10 % from calibration: foreshortening or participant/camera moved.',
        CAMERA_OR_FEET_SHIFT: 'Ankle position shifted since calibration: camera moved or feet slid. Metric distances are unreliable.',
        CAMERA_TILT: 'Standing shank was not vertical in the image (>5°): the camera may be tilted.',
        STANDING_CAL_KNEE_FLEXED: 'The standing calibration knee was flexed; the full-stand reference may be too low.',
        HIP_RISE_IMPLAUSIBLE: 'Seated-to-standing hip rise is outside the plausible range: check the height entered and the calibration.',
        KNEE_2D_3D_DISAGREE: '2D and 3D knee angles disagree by >10° on average (often an oblique view).',
        FACING_AMBIGUOUS: 'Facing direction could not be determined consistently (knee vs foot). Trunk/shank sign may be wrong.',
        ARM_USE_SUSPECTED: 'Hands appeared to leave the chest during a rise. CDC protocol: arm use invalidates the test.',
        MANUAL_STOP: 'The operator stopped the test before 30 s.',
        MOVED_BEFORE_GO: 'The participant started to stand before "Go".',
        NOT_SEATED_AT_START: 'The participant was not seated at rest before "Go".',
        NO_REPS_DETECTED: 'No stand was detected.'
    };

    // ------------------------------------------------------------------ utilities
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
    function beep(freq, dur) {
        if (!CONFIG.sounds.enabled) return;
        try {
            S.audio = S.audio || new (window.AudioContext || window.webkitAudioContext)();
            const o = S.audio.createOscillator(), g = S.audio.createGain();
            o.frequency.value = freq; g.gain.value = 0.15; o.connect(g); g.connect(S.audio.destination); o.start(); o.stop(S.audio.currentTime + dur / 1000);
        } catch (e) { /* audio is optional */ }
    }
    const sideOf = f => {
        const sc = side => { const s = A.SIDE[side]; return [s.sh, s.hip, s.kn, s.an].reduce((a, li) => a + f.img[li * 4 + 3], 0); };
        return sc('left') >= sc('right') ? 'left' : 'right';
    };
    const chainOK = (f, side) => { const s = A.SIDE[side]; return [s.sh, s.hip, s.kn, s.an].every(li => f.img[li * 4 + 3] >= CONFIG.signal.minVisibility && f.img[li * 4] > 0.005 && f.img[li * 4] < 0.995 && f.img[li * 4 + 1] > 0.005 && f.img[li * 4 + 1] < 0.995); };
    const px = (f, li) => ({ x: f.img[li * 4] * engine.video.videoWidth, y: f.img[li * 4 + 1] * engine.video.videoHeight });

    // ------------------------------------------------------------------ screens
    function home() {
        stopAll();
        app.innerHTML = `<div class="screen center">
          <div class="logo">SIT-TO-STAND <span>LAB</span></div>
          <h3 style="margin:0">Biomechanical 30-second chair stand</h3>
          <p>Computer-vision assessment following the CDC STEADI 30-Second Chair Stand protocol. Counts stands and measures timing, hip velocity, joint angles, trunk lean and fatigue - with full data quality reporting.</p>
          <button class="btn btn-primary btn-large" id="go">New assessment</button>
          <div class="row" style="width:100%"><button class="btn btn-secondary" id="hist">History &amp; unsent data</button></div>
          <div class="note"><b>Not a medical device.</b> Outputs are camera-based research/screening estimates, not a diagnosis. Thresholds are engineering defaults pending validation against a criterion measure.</div>
          <div class="note info"><b>Privacy.</b> Video never leaves the device and is never stored. Pose landmarks are processed in the browser. Only numeric results are saved locally and, if configured and consented, sent to the study Google Sheet.</div>
          <p class="status">v${CONFIG.app.version} &middot; analysis ${CONFIG.app.analysisVersion} &middot; schema ${CONFIG.app.schemaVersion}</p>
        </div>`;
        $('#go').onclick = setup; $('#hist').onclick = history;
    }

    function setup() {
        const p = S.participant || {};
        const sheetsOn = !!CONFIG.sheets.webhookUrl;
        app.innerHTML = `<div class="screen">
          <h2>Participant &amp; setup</h2>
          <form class="form" id="f" autocomplete="off">
            <div class="fg"><label>Participant ID (pseudonymous - no real names)</label><input id="pid" required value="${esc(p.id)}"></div>
            <div class="grid2">
              <div class="fg"><label>Age (years)</label><input id="age" type="number" min="18" max="110" required value="${esc(p.age)}"></div>
              <div class="fg"><label>Sex (for CDC norms)</label><select id="sex"><option value="female">Female</option><option value="male">Male</option><option value="other">Other / prefer not to say</option></select></div>
            </div>
            <div class="grid2">
              <div class="fg"><label>Standing height (cm) - measured</label><input id="h" type="number" min="120" max="210" step="0.1" required value="${esc(p.heightCm)}"><div class="hint">Sets the pixel-to-metre scale. Enter accurately.</div></div>
              <div class="fg"><label>Body mass (kg, optional)</label><input id="m" type="number" min="25" max="250" step="0.1" value="${esc(p.massKg)}"></div>
            </div>
            <div class="grid2">
              <div class="fg"><label>Chair seat height (cm)</label><input id="ch" type="number" step="0.1" value="${esc(p.chairCm || CONFIG.protocol.chairHeightCm)}"><div class="hint">STEADI: 17 in = 43.2 cm, straight back, no arms, against a wall.</div></div>
              <div class="fg"><label>Site / session label</label><input id="site" value="${esc(p.site)}"></div>
            </div>
            <div class="grid2">
              <div class="fg"><label>Camera</label><select id="cam"><option value="environment">Rear camera (phone/tablet)</option><option value="user">Front camera / webcam</option></select></div>
              <div class="fg"><label>Pose model</label><select id="model"><option value="full">Full (recommended)</option><option value="heavy">Heavy (most accurate, needs fast device)</option><option value="lite">Lite (fastest)</option></select></div>
            </div>
            <div class="fg"><label>Notes (no identifying information)</label><textarea id="notes" rows="2">${esc(p.notes)}</textarea></div>
            <h3>Protocol checklist</h3>
            <label class="check"><input type="checkbox" id="c1" required> Operator will stand next to the participant for safety; participant has no condition making the test unsafe.</label>
            <label class="check"><input type="checkbox" id="c2" required> Participant instructed: sit mid-chair, feet flat, <b>arms crossed on chest (hands on opposite shoulders)</b>, stand fully then sit, repeatedly for 30 s. If arms are used to stand, the test is invalid.</label>
            ${sheetsOn ? '<label class="check"><input type="checkbox" id="c3"> Participant consents to upload of the derived numeric results to the study Google Sheet.</label>' : '<p class="status">Google Sheets upload is not configured (CONFIG.sheets.webhookUrl is empty): data stays on this device unless downloaded.</p>'}
            <div class="err" id="err"></div>
            <div class="row"><button type="button" class="btn btn-secondary" id="back">Back</button><button class="btn btn-primary" id="next">Continue to camera</button></div>
            <p class="status" id="ms"></p>
          </form></div>`;
        $('#sex').value = p.sex || 'female'; $('#cam').value = p.cam || 'environment'; $('#model').value = p.model || CONFIG.pose.defaultModel;
        if (sheetsOn && p.consent) $('#c3').checked = true;
        $('#back').onclick = home;
        $('#f').onsubmit = async e => {
            e.preventDefault();
            const h = parseFloat($('#h').value), age = parseInt($('#age').value, 10);
            const [lo, hi] = CONFIG.calibration.heightRangeCm;
            if (!(h >= lo && h <= hi)) { $('#err').textContent = 'Height must be ' + lo + '-' + hi + ' cm.'; return; }
            const m = parseFloat($('#m').value);
            S.participant = { id: $('#pid').value.trim(), age, sex: $('#sex').value, heightCm: h, massKg: Number.isFinite(m) ? m : NaN, chairCm: parseFloat($('#ch').value) || CONFIG.protocol.chairHeightCm,
                site: $('#site').value.trim(), notes: $('#notes').value.trim(), armsCrossed: $('#c2').checked, cam: $('#cam').value, model: $('#model').value, consent: sheetsOn && $('#c3').checked };
            $('#next').disabled = true; $('#err').textContent = '';
            try { await engine.initialize(S.participant.model, m2 => { $('#ms').textContent = m2; }); }
            catch (err) { console.error(err); $('#err').textContent = 'Could not load the pose model: ' + err.message + ' (needs internet on first load).'; $('#next').disabled = false; return; }
            session();
        };
    }

    // ------------------------------------------------------------------ live session
    async function session() {
        stopAll();
        Object.assign(S, { step: 'position', ring: [], cap: null, standFrames: null, calib: null, rec: null, tFrames: [], attempted: 0, liveCount: 0, liveState: 'seated', pEma: null, side: null, result: null, manualStop: false, sheetsStatus: '' });
        app.innerHTML = `<div class="live-session">
          <div class="live-video-wrap ${S.participant.cam === 'user' ? 'mirror' : ''}" id="vw">
            <video id="video" playsinline muted></video><canvas id="cv"></canvas>
            <div class="hud"><div class="hud-time" id="ht"></div><div class="hud-reps" id="hr"></div></div>
            <div class="live-overlay"><div class="overlay-status" id="ov">Starting camera…</div></div>
            <div class="angle-panel" id="ap"></div>
          </div>
          <div class="controls" id="ctl"></div></div>`;
        try { await engine.startCamera($('#video'), $('#cv'), S.participant.cam); }
        catch (e) { $('#ov').textContent = 'Camera error: ' + e.message + '\nAllow camera access (HTTPS required) and retry.'; $('#ctl').innerHTML = '<button class="btn btn-secondary" id="b">Back</button>'; $('#b').onclick = setup; return; }
        engine.onFrame = onFrame; engine.overlay = { lines: [], angles: null }; engine.showLabels = true;
        setStep('position');
    }

    function setStep(step, msg) {
        S.step = step;
        const ov = $('#ov'), ctl = $('#ctl'); if (!ov) return;
        ov.classList.remove('big');
        const back = '<button class="btn btn-secondary btn-small" id="bk" style="flex:.5">Exit</button>';
        const wireBack = () => { const b = $('#bk'); if (b) b.onclick = () => { stopAll(); setup(); }; };
        if (step === 'position') {
            ov.textContent = msg || 'Place the camera 2–3 m away at hip height, SIDE-ON to the chair (perpendicular), chair against a wall.\nWhole body, head to feet, must be in view.';
            ctl.innerHTML = back + '<button class="btn btn-secondary btn-small" id="lb" style="flex:.7">Labels</button><button class="btn btn-primary" id="nx" disabled>Calibrate standing</button>';
            wireBack(); $('#lb').onclick = () => { engine.showLabels = !engine.showLabels; };
            $('#nx').onclick = () => { S.cap = { buf: [] }; setStep('calStand'); };
        } else if (step === 'calStand') {
            ov.innerHTML = (msg ? esc(msg) + '\n' : '') + 'STANDING CALIBRATION\nStand tall, side-on, feet flat, hold completely still.<div class="progress"><div id="pb"></div></div>';
            ctl.innerHTML = back; wireBack();
        } else if (step === 'calSeat') {
            ov.innerHTML = (msg ? esc(msg) + '\n' : '') + 'SEATED CALIBRATION\nSit back on the chair, feet flat, <b>arms crossed on chest</b>, upright. Hold still.<div class="progress"><div id="pb"></div></div>';
            ctl.innerHTML = back; wireBack();
        } else if (step === 'ready') {
            const c = S.calib;
            ov.innerHTML = '<b class="good">Calibrated</b>\nScale ' + (c.scale * 1000).toFixed(3) + ' mm/px · hip rise ' + c.hipRiseM.toFixed(2) + ' m · dominant side ' + c.side +
                '\nParticipant stays seated, arms crossed.\nDo not move the camera or chair from now on.';
            ctl.innerHTML = back + '<button class="btn btn-secondary btn-small" id="rc" style="flex:.7">Recalibrate</button><button class="btn btn-primary" id="st">Start 30-s test</button>';
            wireBack(); $('#rc').onclick = () => { S.cap = { buf: [] }; engine.overlay.lines = []; setStep('calStand'); };
            $('#st').onclick = () => { beep(1, 1); countdown(); };
        } else if (step === 'countdown') {
            ov.classList.add('big'); ctl.innerHTML = '<button class="btn btn-danger" id="ab">Abort</button>';
            $('#ab').onclick = () => { stopAll(); session(); };
        } else if (step === 'test') {
            ov.textContent = ''; ctl.innerHTML = '<button class="btn btn-danger" id="se">Stop early (safety)</button>';
            $('#se').onclick = () => finish(true);
        } else if (step === 'finishing') {
            ov.textContent = 'TIME!\nStay still…'; ctl.innerHTML = '';
        } else if (step === 'analyzing') {
            ov.textContent = 'Analysing…'; ctl.innerHTML = '';
        }
    }

    function updateReadiness(f) {
        const nx = $('#nx'); if (!nx) return;
        let msg, ready = false;
        if (!f) msg = 'No person detected.';
        else {
            const side = sideOf(f); S.side = side; engine.side = side;
            const s = A.SIDE[side], nose = f.img[1], foot = Math.max(f.img[s.an * 4 + 1], f.img[s.toe * 4 + 1]);
            const obl = Math.abs(f.img[A.SIDE.left.hip * 4] - f.img[A.SIDE.right.hip * 4]) * engine.video.videoWidth /
                Math.max(1, Math.hypot(px(f, s.sh).x - px(f, s.hip).x, px(f, s.sh).y - px(f, s.hip).y));
            if (!chainOK(f, side)) msg = 'Shoulder, hip, knee and ankle must all be clearly visible.';
            else if (nose < 0.01 || foot > 0.985) msg = 'Step back / lower the camera: whole body from head to feet must fit in the frame.';
            else if (obl > 0.3) msg = 'Turn SIDE-ON to the camera (left or right shoulder towards the lens).';
            else { msg = 'Ready: full body visible and side-on.'; ready = true; }
        }
        const ov = $('#ov'); if (ov && S.step === 'position') ov.innerHTML = '<span class="' + (ready ? 'good' : 'warn') + '">' + esc(msg) + '</span>\nCamera 2–3 m away, hip height, perpendicular to the chair.';
        nx.disabled = !ready;
    }

    function feedCapture(f, tMs) {
        const cc = CONFIG.calibration, cap = S.cap, pb = $('#pb');
        if (!f || !chainOK(f, S.side || sideOf(f))) { cap.buf = []; if (pb) pb.style.width = '0'; return; }
        const side = S.side || sideOf(f), s = A.SIDE[side];
        cap.buf.push({ tMs, f });
        const span = (tMs - cap.buf[0].tMs) / 1000;
        const idx = [s.sh, s.hip, s.kn, s.an];
        let jit = 0;
        for (const li of idx) {
            const xs = cap.buf.map(b => px(b.f, li).x), ys = cap.buf.map(b => px(b.f, li).y);
            const sdv = a => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) * (q - m), 0) / a.length); };
            jit = Math.max(jit, sdv(xs), sdv(ys));
        }
        const l0 = cap.buf[cap.buf.length - 1].f, trunk = Math.hypot(px(l0, s.sh).x - px(l0, s.hip).x, px(l0, s.sh).y - px(l0, s.hip).y);
        if (cap.buf.length > 5 && jit / trunk > cc.maxJitterTrunkFrac) { cap.buf = [cap.buf[cap.buf.length - 1]]; if (pb) pb.style.width = '0'; return; }
        if (pb) pb.style.width = Math.min(100, 100 * span / cc.holdS) + '%';
        if (span < cc.holdS) return;
        const frames = cap.buf.map(b => b.f); cap.buf = [];
        const W = engine.video.videoWidth, H = engine.video.videoHeight;
        if (S.step === 'calStand') {
            const d = A.describePose(A.medianPose(frames, W, H), side, 1, null, CONFIG.signal.minVisibility);
            if (d.kneeFlex > cc.standMaxKneeFlexDeg || Math.abs(d.trunkIncl) > cc.standMaxTrunkInclDeg) { setStep('calStand', 'Stand taller (knees straight, trunk upright) and try again.'); S.cap = { buf: [] }; return; }
            S.standFrames = frames; beep(900, 120); S.cap = { buf: [] }; setStep('calSeat');
        } else {
            const calib = A.buildCalibration(S.standFrames, frames, W, H, S.participant.heightCm, CONFIG);
            const issues = A.checkCalibration(calib, CONFIG);
            if (calib.seat.kneeFlex < cc.seatMinKneeFlexDeg) issues.push('Seated knee angle is too open (' + calib.seat.kneeFlex.toFixed(0) + '°): sit properly on the chair.');
            if (issues.length) { S.cap = { buf: [] }; setStep('calStand', issues.join(' ') + ' Redo calibration.'); return; }
            S.calib = calib; S.side = calib.side; engine.side = calib.side; beep(1200, 200);
            const y = p => calib.seat.hipY - p * (calib.seat.hipY - calib.stand.hipY);
            engine.overlay.lines = [{ y: y(0), label: 'SEATED 0%', color: '#ffd700' }, { y: y(CONFIG.protocol.halfwayProgress), label: '50% (half-way)', color: '#7fd4ff' }, { y: y(1), label: 'STAND 100%', color: '#4cdf7c' }];
            setStep('ready');
        }
    }

    function liveMetrics(f) {
        const c = S.calib; if (!f || !c) return null;
        const s = A.SIDE[c.side], P = li => px(f, li);
        const a = A.poseAngles(P(s.sh), P(s.hip), P(s.kn), P(s.an), P(s.toe), c.facing);
        const p = (c.seat.hipY - P(s.hip).y) / (c.seat.hipY - c.stand.hipY);
        S.pEma = S.pEma === null ? p : CONFIG.live.emaAlpha * p + (1 - CONFIG.live.emaAlpha) * S.pEma;
        return { a, p: S.pEma };
    }

    function onFrame(f, tMs) {
        const step = S.step;
        if (f && ['position', 'calStand', 'calSeat', 'ready', 'countdown'].includes(step)) { S.ring.push(f); while (S.ring.length && S.ring[0].tMs < tMs - 2500) S.ring.shift(); }
        if (step === 'position') updateReadiness(f);
        else if (step === 'calStand' || step === 'calSeat') feedCapture(f, tMs);
        const lm = (step === 'ready' || step === 'countdown' || step === 'test' || step === 'finishing') ? liveMetrics(f) : null;
        if (lm) {
            engine.overlay.angles = { knee: lm.a.kneeFlex, hip: lm.a.hipFlex, trunk: lm.a.trunkIncl };
            if (step === 'test') {
                if (S.liveState === 'seated' && lm.p >= CONFIG.live.standAt) { S.liveState = 'standing'; if ((tMs - S.t0) / 1000 <= T) { S.liveCount++; beep(800, 90); } }
                else if (S.liveState === 'standing' && lm.p <= CONFIG.live.seatAt) S.liveState = 'seated';
            }
            const ap = $('#ap'); if (ap) ap.textContent = 'knee ' + lm.a.kneeFlex.toFixed(0) + '°  hip ' + lm.a.hipFlex.toFixed(0) + '°  trunk ' + lm.a.trunkIncl.toFixed(0) + '°\nprogress ' + (lm.p * 100).toFixed(0) + '%  ' + engine.fpsEMA.toFixed(0) + ' fps';
        } else if (!f && step !== 'position') { const ap = $('#ap'); if (ap) ap.textContent = 'NO POSE DETECTED'; }
        if (step === 'test' || step === 'finishing') {
            const el = (tMs - S.t0) / 1000;
            if (el >= 0) { if (el <= T) S.attempted++; if (f && el <= T + CONFIG.protocol.tailS + 0.1) S.tFrames.push(f); }
        }
    }

    function countdown() {
        stopTimers(); let n = CONFIG.protocol.countdownS; setStep('countdown');
        const show = () => { $('#ov').textContent = n > 0 ? n : 'GO'; };
        show(); beep(600, 200);
        S.cdTimer = setInterval(() => {
            n--; if (n > 0) { show(); beep(600, 200); return; }
            clearInterval(S.cdTimer); S.cdTimer = null; show(); beep(1000, 400); startTest();
        }, 1000);
    }

    function startTest() {
        S.t0 = performance.now();
        const lo = S.t0 - CONFIG.protocol.preRollS * 1000;
        S.tFrames = S.ring.filter(f => f.tMs >= lo); S.attempted = 0; S.liveCount = 0; S.liveState = 'seated';
        setStep('test'); setTimeout(() => { const o = $('#ov'); if (o && S.step === 'test') { o.classList.remove('big'); o.textContent = ''; } }, 600);
        S.timer = setInterval(() => {
            const el = (performance.now() - S.t0) / 1000, rem = Math.max(0, T - el);
            const ht = $('#ht'), hr = $('#hr'); if (ht) ht.textContent = rem.toFixed(1); if (hr) hr.innerHTML = S.liveCount + '<small>STANDS (live)</small>';
            if (el >= T && S.step === 'test') { beep(1200, 600); setStep('finishing'); }
            if (el >= T + CONFIG.protocol.tailS && S.step === 'finishing') finish(false);
        }, 100);
    }

    function finish(manual) {
        if (S.step === 'analyzing') return;
        const elapsed = Math.min((performance.now() - S.t0) / 1000, T + CONFIG.protocol.tailS);
        stopTimers(); S.manualStop = !!manual; setStep('analyzing');
        const W = engine.video.videoWidth, H = engine.video.videoHeight;
        const rec = { W, H, t0Ms: S.t0, attempted: S.attempted, frames: S.tFrames.slice().sort((a, b) => a.tMs - b.tMs) };
        const meta = { sessionId: uuid(), timestampUtc: new Date().toISOString(), utcOffsetMin: -new Date().getTimezoneOffset(), poseModel: engine.model, delegate: engine.delegate,
            cameraFacing: S.participant.cam, userAgent: navigator.userAgent, elapsedS: manual ? elapsed : T, manualStop: manual, liveCount: S.liveCount };
        engine.stop();
        setTimeout(() => {
            let res;
            try { res = A.analyzeSession({ recording: rec, calib: S.calib, participant: S.participant, meta, cfg: CONFIG, schema: SCHEMA }); }
            catch (e) { console.error(e); res = { error: 'Analysis failed: ' + e.message }; }
            if (res.error) { app.innerHTML = '<div class="screen center"><h2>Analysis problem</h2><p>' + esc(res.error) + '</p><button class="btn btn-primary" id="r">Try again</button></div>'; $('#r').onclick = session; return; }
            S.result = res; S.rec = rec;
            Exporter.addHistory(res.summary);
            results();
            if (CONFIG.sheets.webhookUrl && S.participant.consent) uploadSheets();
        }, 60);
    }

    function stopTimers() { if (S.timer) clearInterval(S.timer); if (S.cdTimer) clearInterval(S.cdTimer); S.timer = S.cdTimer = null; }
    function stopAll() { stopTimers(); engine.onFrame = null; engine.stop(); }

    // ------------------------------------------------------------------ results
    function metric(t, v) { return '<div class="metric"><div class="t">' + t + '</div><div class="v">' + v + '</div></div>'; }
    function results() {
        const r = S.result, s = r.summary;
        const flags = s.qc_flags ? s.qc_flags.split('; ') : [];
        const normTxt = s.norm_classification === 'Not classified' ? '<span class="badge neutral">Norm: not classified</span>' :
            '<span class="badge ' + (s.norm_classification === 'Below average' ? 'review' : 'ok') + '">' + esc(s.norm_classification) + ' (cut-off &lt; ' + s.norm_cutoff_below_average + ')</span>';
        const repRows = r.reps.map(p => '<tr class="' + (p.counted ? '' : 'uncounted') + '"><td>' + (p.counted ? p.stand_number : '–') + (p.counted_by_half_rule ? '½' : '') + '</td><td>' + (p.t_onset_s ?? '') + '</td><td>' + (p.ascent_time_s ?? '') + '</td><td>' + (p.standing_dwell_s ?? '') + '</td><td>' + (p.descent_time_s ?? '') + '</td><td>' + (p.cycle_time_s ?? '') + '</td><td>' + (p.peak_ascent_velocity_m_s ?? '') + '</td><td>' + (p.hip_rise_m ?? '') + '</td><td>' + (p.knee_rom_deg ?? '') + '</td><td>' + (p.trunk_lean_peak_deg ?? '') + '</td><td>' + (p.arm_use_flag !== 'no' ? p.arm_use_flag : '') + (p.tracking_gap_flag ? ' gap' : '') + (!p.counted ? ' not counted' : '') + '</td></tr>').join('');
        app.innerHTML = `<div class="screen">
          <div class="big-score"><div class="big-number">${s.stands_count}</div><div class="big-label">stands in ${s.test_duration_s} s</div>
            <div>${normTxt}<span class="badge ${s.qc_pass ? 'ok' : 'review'}">${s.qc_pass ? 'QC pass' : 'QC: review'}</span>${s.half_rule_applied ? '<span class="badge neutral">½-stand rule used</span>' : ''}</div>
            <p class="status">Live display showed ${s.live_count}${s.count_difference ? ' <span class="warn">(offline analysis differs by ' + s.count_difference + ')</span>' : ''} &middot; ${esc(s.participant_id)} &middot; ${esc(s.session_id.slice(0, 8))}</p></div>
          ${flags.length ? '<div>' + flags.map(f => '<div class="flag ' + (CONFIG.qc.blocking.includes(f) ? 'block' : '') + '"><b>' + f + '</b> – ' + esc(FLAG_INFO[f] || '') + '</div>').join('') + '</div>' : ''}
          <h3>Timing &amp; pacing</h3><div class="metrics">
            ${metric('Cycle time', fmt(s.cycle_time_mean_s, 2, 's') + ' ± ' + fmt(s.cycle_time_sd_s, 2))}${metric('Cycle CV', fmt(s.cycle_time_cv_pct, 1, '%'))}
            ${metric('Ascent time', fmt(s.ascent_time_mean_s, 2, 's'))}${metric('Descent time', fmt(s.descent_time_mean_s, 2, 's'))}
            ${metric('Time to 1st stand', fmt(s.time_to_first_stand_s, 2, 's'))}${metric('Stands 1st / 2nd half', s.stands_first_half + ' / ' + s.stands_second_half)}
            ${metric('Cycle-time trend', fmt(s.cycle_time_slope_s_per_rep, 3, 's/rep'))}${metric('Slowing (last vs first third)', fmt(s.cycle_time_change_pct, 1, '%'))}</div>
          <h3>Hip kinematics</h3><div class="metrics">
            ${metric('Peak ascent velocity', fmt(s.peak_ascent_velocity_mean_m_s, 2, 'm/s'))}${metric('Mean ascent velocity', fmt(s.ascent_mean_velocity_mean_m_s, 2, 'm/s'))}
            ${metric('Peak descent speed', fmt(s.peak_descent_velocity_mean_m_s, 2, 'm/s'))}${metric('Hip rise (10–90%)', fmt(s.hip_rise_mean_m, 3, 'm'))}
            ${metric('Velocity change (last vs first third)', fmt(s.ascent_velocity_change_pct, 1, '%'))}${metric('Work-rate proxy', fmt(s.work_rate_proxy_mean_w, 0, 'W'))}</div>
          <h3>Joint &amp; trunk kinematics</h3><div class="metrics">
            ${metric('Knee: seated → standing', fmt(s.knee_flex_seated_mean_deg, 0) + ' → ' + fmt(s.knee_flex_standing_mean_deg, 0, '°'))}${metric('Knee ROM', fmt(s.knee_rom_mean_deg, 0, '°'))}
            ${metric('Peak knee ext. velocity', fmt(s.knee_ext_peak_velocity_mean_deg_s, 0, '°/s'))}${metric('Peak hip ext. velocity', fmt(s.hip_ext_peak_velocity_mean_deg_s, 0, '°/s'))}
            ${metric('Peak trunk lean (mean / max)', fmt(s.trunk_lean_peak_mean_deg, 0) + ' / ' + fmt(s.trunk_lean_peak_max_deg, 0, '°'))}${metric('Trunk at stand', fmt(s.trunk_incl_standing_mean_deg, 1, '°'))}
            ${metric('Hip flexion: seated → standing', fmt(s.hip_flex_seated_mean_deg, 0) + ' → ' + fmt(s.hip_flex_standing_mean_deg, 0, '°'))}${metric('Peak shank inclination', fmt(s.shank_incl_peak_mean_deg, 0, '°'))}</div>
          <h3>Charts</h3>
          <canvas class="chart" id="c1"></canvas><canvas class="chart" id="c2"></canvas><canvas class="chart" id="c3"></canvas>
          <p class="status">Shading: <span style="color:#7fd4ff">ascent</span> · <span style="color:#4cdf7c">standing</span> · <span style="color:#ffa500">descent</span>. Gold lines = 0 s and 30 s.</p>
          <h3>Repetitions</h3>
          <div class="tablewrap"><table><thead><tr><th>#</th><th>onset s</th><th>asc s</th><th>stand s</th><th>desc s</th><th>cycle s</th><th>v↑ m/s</th><th>rise m</th><th>knee ROM°</th><th>trunk lean°</th><th>flags</th></tr></thead><tbody>${repRows}</tbody></table></div>
          <details><summary>Data quality &amp; calibration</summary><div class="metrics" style="margin-top:8px">
            ${metric('Detector rate', fmt(s.effective_fs_hz, 1, 'Hz'))}${metric('Valid frames', fmt(s.valid_frame_pct, 1, '%'))}${metric('Longest tracking gap', fmt(s.longest_gap_s, 2, 's'))}
            ${metric('Chain visibility', fmt(s.median_chain_visibility, 2))}${metric('View obliquity', fmt(s.view_obliquity_median, 2))}${metric('Knee 2D vs 3D', fmt(s.knee_2d_3d_diff_deg, 1, '°'))}
            ${metric('Scale', fmt(s.scale_m_per_px * 1000, 3, 'mm/px'))}${metric('Scale check', fmt(s.scale_check_diff_pct, 1, '%'))}${metric('Calibrated hip rise', fmt(s.calib_hip_rise_m, 3, 'm'))}</div></details>
          <div class="note info" id="sh">${CONFIG.sheets.webhookUrl ? (S.participant.consent ? 'Google Sheets: uploading…' : 'Google Sheets upload not consented for this participant.') : 'Google Sheets not configured.'}</div>
          <div class="row"><button class="btn btn-primary" id="zip">Download all data (ZIP)</button>${CONFIG.sheets.webhookUrl ? '<button class="btn btn-secondary" id="up">Upload to Sheets</button>' : ''}</div>
          <div class="row"><button class="btn btn-secondary" id="again">Same participant, new test</button><button class="btn btn-secondary" id="newp">New participant</button><button class="btn btn-secondary" id="hm">Home</button></div>
          <div class="note">Camera-based estimate for fitness / research use, not a diagnosis. Counts follow the CDC STEADI rules; kinematic values depend on camera alignment (see QC). Method details: DATA_DICTIONARY.md.</div>
        </div>`;
        $('#zip').onclick = () => {
            const files = Exporter.sessionFiles(r, S.rec, S.calib, CONFIG, SCHEMA);
            Exporter.download(s.session_id + '.zip', Exporter.makeZip(files), 'application/zip');
        };
        const up = $('#up'); if (up) up.onclick = () => uploadSheets(true);
        $('#again').onclick = session; $('#newp').onclick = () => { S.participant = null; setup(); }; $('#hm').onclick = home;
        requestAnimationFrame(() => drawCharts(r));
    }

    function drawCharts(r) {
        const t = r.series.t, ev = r.events, marks = [];
        const shade = [];
        for (const e of ev) {
            if (!e.counted) continue;
            shade.push({ t0: e.onset, t1: e.standing, color: 'rgba(127,212,255,.14)' });
            if (e.descent !== null) shade.push({ t0: e.standing, t1: e.descent, color: 'rgba(76,223,124,.13)' }, { t0: e.descent, t1: e.seat !== null ? e.seat : e.descent, color: 'rgba(255,165,0,.14)' });
            marks.push({ t: e.half, color: 'rgba(255,255,255,.35)' });
        }
        const win = [0, T];
        Charts.line($('#c1'), { t, series: [{ y: r.series.progress, color: '#00d4d4', label: 'hip progress (0 seated, 1 standing)' }], shade, marks, hlines: [{ y: 0, color: '#ffd700' }, { y: 0.5, color: '#7fd4ff' }, { y: 1, color: '#4cdf7c' }], yLabel: 'progress', window: win, xMin: -1 });
        Charts.line($('#c2'), { t, series: [{ y: r.series.kneeFlex, color: '#4cdf7c', label: 'knee flexion' }, { y: r.series.hipFlex, color: '#ffd700', label: 'hip flexion' }, { y: r.series.trunkIncl, color: '#7fd4ff', label: 'trunk incl.' }], shade, yLabel: 'degrees', window: win, xMin: -1 });
        Charts.line($('#c3'), { t, series: [{ y: r.series.hipVel, color: '#ff6b57', label: 'hip vertical velocity' }], shade, hlines: [{ y: 0 }], yLabel: 'm/s', window: win, xMin: -1 });
    }

    async function uploadSheets(manual) {
        const box = $('#sh'); const set = m => { S.sheetsStatus = m; const b = $('#sh'); if (b) b.innerHTML = m; };
        if (!CONFIG.sheets.webhookUrl) return;
        set('Google Sheets: uploading…');
        const payload = Exporter.buildPayload(S.result, CONFIG);
        const r = await Exporter.sendToSheets(payload, CONFIG);
        if (r.status === 'confirmed') set('<span class="good">Google Sheets: saved' + (r.detail && r.detail.status === 'duplicate' ? ' (already present)' : '') + '.</span>');
        else if (r.status === 'sent_unconfirmed') set('<span class="warn">Google Sheets: sent, but the browser cannot confirm receipt (CORS). Check the sheet; re-sending is safe (de-duplicated by session ID).</span>');
        else { Exporter.queue(payload); set('<span class="bad">Google Sheets: failed (' + esc(r.error || (r.detail && r.detail.message) || r.status) + '). Saved to the outbox - retry from History.</span>'); }
    }

    // ------------------------------------------------------------------ history
    function history() {
        stopAll();
        const h = Exporter.getHistory(), ob = Exporter.outboxCount();
        app.innerHTML = `<div class="screen"><h2>History</h2>
          ${ob ? '<div class="note">' + ob + ' result(s) waiting to upload. <button class="btn btn-small btn-primary" id="fl">Retry now</button></div>' : ''}
          <div class="hist">${h.length ? h.map(s => '<div class="card"><b>' + esc(s.participant_id) + '</b> · ' + s.stands_count + ' stands · ' + esc(new Date(s.timestamp_utc).toLocaleString()) + '<br><span class="status">' + esc(s.norm_classification) + ' · QC ' + (s.qc_pass ? 'pass' : 'review') + ' · cycle ' + (s.cycle_time_mean_s ?? '–') + ' s · ' + esc(s.session_id.slice(0, 8)) + '</span></div>').join('') : '<p>No saved sessions on this device.</p>'}</div>
          <div class="row"><button class="btn btn-secondary" id="b">Back</button><button class="btn btn-danger" id="cl">Clear local history</button></div>
          <p class="status">Local history stores summary values only (no video, no landmarks). Use the ZIP download on the results screen for full data.</p></div>`;
        $('#b').onclick = home;
        $('#cl').onclick = () => { if (confirm('Clear the local history on this device? This cannot be undone. Unsent outbox items are kept.')) { Exporter.clearHistory(); history(); } };
        const fl = $('#fl'); if (fl) fl.onclick = async () => { fl.disabled = true; const r = await Exporter.flushOutbox(CONFIG); alert('Sent ' + r.sent + ', remaining ' + r.remaining); history(); };
    }

    window.addEventListener('online', () => { if (CONFIG.sheets.webhookUrl && Exporter.outboxCount()) Exporter.flushOutbox(CONFIG); });
    window.addEventListener('pagehide', stopAll);
    home();
})();
