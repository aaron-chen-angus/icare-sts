/** Minimal dependency-free line charts (canvas) with shaded phases and event markers. */
const Charts = {
    line(canvas, o) {
        const dpr = window.devicePixelRatio || 1;
        const cw = canvas.clientWidth || 360, ch = canvas.clientHeight || 200;
        canvas.width = cw * dpr; canvas.height = ch * dpr;
        const c = canvas.getContext('2d');
        c.scale(dpr, dpr);
        const L = 44, R = 10, T = 14, B = 26, w = cw - L - R, h = ch - T - B;
        const t = o.t;
        const x0 = o.xMin !== undefined ? o.xMin : t[0], x1 = o.xMax !== undefined ? o.xMax : t[t.length - 1];
        let lo = Infinity, hi = -Infinity;
        for (const s of o.series) for (let i = 0; i < s.y.length; i++) { const v = s.y[i]; if (Number.isFinite(v) && t[i] >= x0 && t[i] <= x1) { if (v < lo) lo = v; if (v > hi) hi = v; } }
        if (o.yMin !== undefined) lo = o.yMin; if (o.yMax !== undefined) hi = o.yMax;
        if (!Number.isFinite(lo) || lo === hi) { lo = 0; hi = 1; }
        const pad = (hi - lo) * 0.06; if (o.yMin === undefined) lo -= pad; if (o.yMax === undefined) hi += pad;
        const X = v => L + (v - x0) / (x1 - x0) * w, Y = v => T + h - (v - lo) / (hi - lo) * h;
        c.fillStyle = '#1a1f3a'; c.fillRect(0, 0, cw, ch);
        for (const s of (o.shade || [])) { c.fillStyle = s.color; c.fillRect(X(Math.max(x0, s.t0)), T, Math.max(1, X(Math.min(x1, s.t1)) - X(Math.max(x0, s.t0))), h); }
        c.strokeStyle = 'rgba(255,255,255,0.08)'; c.fillStyle = '#a0a8c0'; c.font = '11px sans-serif'; c.lineWidth = 1;
        const nice = (a, b, n) => { const r = (b - a) / n, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
        const ys = nice(lo, hi, 4); c.textAlign = 'right'; c.textBaseline = 'middle';
        for (let v = Math.ceil(lo / ys) * ys; v <= hi; v += ys) { c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(L + w, Y(v)); c.stroke(); c.fillText(+v.toFixed(2), L - 5, Y(v)); }
        const xs = nice(x0, x1, 6); c.textAlign = 'center'; c.textBaseline = 'top';
        for (let v = Math.ceil(x0 / xs) * xs; v <= x1; v += xs) { c.beginPath(); c.moveTo(X(v), T); c.lineTo(X(v), T + h); c.stroke(); c.fillText(+v.toFixed(1), X(v), T + h + 4); }
        for (const hl of (o.hlines || [])) { c.save(); c.setLineDash([5, 4]); c.strokeStyle = hl.color || '#c0c8d4'; c.beginPath(); c.moveTo(L, Y(hl.y)); c.lineTo(L + w, Y(hl.y)); c.stroke(); c.restore(); }
        for (const m of (o.marks || [])) { if (m.t < x0 || m.t > x1) continue; c.strokeStyle = m.color; c.lineWidth = 1.2; c.beginPath(); c.moveTo(X(m.t), T); c.lineTo(X(m.t), T + h); c.stroke(); }
        for (const s of o.series) {
            c.strokeStyle = s.color; c.lineWidth = 2; c.beginPath(); let pen = false;
            for (let i = 0; i < s.y.length; i++) { if (t[i] < x0 || t[i] > x1 || !Number.isFinite(s.y[i])) { pen = false; continue; } const px = X(t[i]), py = Y(s.y[i]); if (!pen) { c.moveTo(px, py); pen = true; } else c.lineTo(px, py); }
            c.stroke();
        }
        // test window edges
        if (o.window) for (const wv of o.window) { c.strokeStyle = 'rgba(255,215,0,0.8)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(wv), T); c.lineTo(X(wv), T + h); c.stroke(); }
        c.fillStyle = '#a0a8c0'; c.textAlign = 'left'; c.textBaseline = 'top';
        let lx = L + 6;
        for (const s of o.series) { c.fillStyle = s.color; c.fillRect(lx, T + 4, 10, 3); c.fillStyle = '#e8ecf0'; c.fillText(s.label, lx + 14, T + 0); lx += 22 + c.measureText(s.label).width + 8; }
        c.save(); c.translate(11, T + h / 2); c.rotate(-Math.PI / 2); c.fillStyle = '#a0a8c0'; c.textAlign = 'center'; c.fillText(o.yLabel || '', 0, 0); c.restore();
        c.textAlign = 'center'; c.fillText('time from Go (s)', L + w / 2, ch - 12);
    }
};
