/**
 * Sit-to-Stand Biomechanics Lab - exports: CSV, ZIP, Google Sheets webhook, local history/outbox.
 * Column order always comes from SCHEMA, so exports cannot drift from the data dictionary.
 */
(function (root) {
    'use strict';

    const csvCell = v => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        const s = String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    function toCSV(rows, fields) {
        const keys = fields.map(f => f.key);
        return [keys.join(',')].concat(rows.map(r => keys.map(k => csvCell(r[k])).join(','))).join('\r\n') + '\r\n';
    }

    /** Raw landmark frames: t_ms relative to Go, then x,y,z,v (normalised image) and wx,wy,wz (world, m) per marker. */
    function rawFramesCSV(rec, cfg) {
        const cols = ['t_ms'];
        for (const m of cfg.tracked) for (const s of ['x', 'y', 'z', 'v', 'wx', 'wy', 'wz']) cols.push(m.key + '_' + s);
        const lines = [cols.join(',')];
        const r4 = v => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : '');
        for (const f of rec.frames) {
            const row = [Math.round(f.tMs - rec.t0Ms)];
            for (let i = 0; i < cfg.tracked.length; i++) {
                row.push(r4(f.img[i * 4]), r4(f.img[i * 4 + 1]), r4(f.img[i * 4 + 2]), r4(f.img[i * 4 + 3]));
                row.push(f.world ? r4(f.world[i * 3]) : '', f.world ? r4(f.world[i * 3 + 1]) : '', f.world ? r4(f.world[i * 3 + 2]) : '');
            }
            lines.push(row.join(','));
        }
        return lines.join('\r\n') + '\r\n';
    }

    // ---- minimal ZIP (store, no compression)
    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    function makeZip(files) {
        const enc = new TextEncoder(), parts = [], central = [];
        let offset = 0;
        const d = new Date();
        const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        for (const f of files) {
            const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
            lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
            lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
            parts.push(new Uint8Array(lh.buffer), name, data);
            const ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
            ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
            ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
            central.push(new Uint8Array(ch.buffer), name);
            offset += 30 + name.length + data.length;
        }
        const cdSize = central.reduce((s, p) => s + p.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
        const all = parts.concat(central, [new Uint8Array(end.buffer)]);
        const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
        let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
        return out;
    }

    function download(name, data, mime) {
        const blob = new Blob([data], { type: mime || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    function paramSnapshot(cfg) {
        return { signal: cfg.signal, events: cfg.events, arms: cfg.arms, qc: cfg.qc, calibration: cfg.calibration, protocol: cfg.protocol, anthropometry: cfg.anthropometry, pose: { numPoses: cfg.pose.numPoses, detectionConfidence: cfg.pose.detectionConfidence, presenceConfidence: cfg.pose.presenceConfidence, trackingConfidence: cfg.pose.trackingConfidence } };
    }

    /** All files for the one-click download. */
    function sessionFiles(result, rec, calib, cfg, schema) {
        const id = result.summary.session_id, S = result.summary;
        const calibOut = JSON.parse(JSON.stringify(calib, (k, v) => (k === 'seatMedian' ? undefined : v)));
        return [
            { name: id + '_summary.csv', data: toCSV([S], schema.summary) },
            { name: id + '_reps.csv', data: toCSV(result.reps, schema.reps) },
            { name: id + '_frames_analysis.csv', data: toCSV(result.frames, schema.frames) },
            { name: id + '_frames_raw.csv', data: rawFramesCSV(rec, cfg) },
            { name: id + '_session.json', data: JSON.stringify({ summary: S, reps: result.reps, calibration: calibOut, parameters: paramSnapshot(cfg) }, null, 1) }
        ];
    }

    // ---- Google Sheets
    function buildPayload(result, cfg) {
        const p = { schemaVersion: cfg.app.schemaVersion, summary: result.summary, reps: result.reps };
        if (cfg.sheets.uploadFrames) p.frames = result.frames;
        return p;
    }
    async function sendToSheets(payload, cfg) {
        const url = cfg.sheets.webhookUrl;
        if (!url) return { status: 'disabled' };
        const body = JSON.stringify(payload), headers = { 'Content-Type': 'text/plain;charset=utf-8' };
        try {
            const r = await fetch(url, { method: 'POST', body, headers });
            const j = await r.json();
            return (j.status === 'success' || j.status === 'duplicate') ? { status: 'confirmed', detail: j } : { status: 'error', detail: j };
        } catch (e) {
            try { await fetch(url, { method: 'POST', mode: 'no-cors', body, headers }); return { status: 'sent_unconfirmed' }; }
            catch (e2) { return { status: 'failed', error: String(e2 && e2.message || e2) }; }
        }
    }

    // ---- local history & outbox (summaries only; raw frames are never kept in localStorage)
    const HKEY = 'stsLab_history', OKEY = 'stsLab_outbox';
    const load = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } };
    const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    function addHistory(summary) { const h = load(HKEY).filter(s => s.session_id !== summary.session_id); h.unshift(summary); save(HKEY, h.slice(0, 300)); }
    const getHistory = () => load(HKEY);
    const clearHistory = () => localStorage.removeItem(HKEY);
    function queue(payload) { const o = load(OKEY).filter(p => p.summary.session_id !== payload.summary.session_id); o.push(payload); save(OKEY, o); }
    const outboxCount = () => load(OKEY).length;
    async function flushOutbox(cfg) {
        const o = load(OKEY), keep = []; let sent = 0;
        for (const p of o) { const r = await sendToSheets(p, cfg); if (r.status === 'confirmed' || r.status === 'sent_unconfirmed') sent++; else keep.push(p); }
        save(OKEY, keep); return { sent, remaining: keep.length };
    }

    const api = { toCSV, rawFramesCSV, makeZip, crc32, download, sessionFiles, buildPayload, sendToSheets, addHistory, getHistory, clearHistory, queue, outboxCount, flushOutbox, paramSnapshot };
    root.Exporter = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
