import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  Legend,
} from 'recharts';
import { api } from './lib/api.js';

/* ─── Storage local de secours ───────────────────────────── */
const localStore = {
  get: (key) => {
    try {
      const val = localStorage.getItem(key);
      return val ? { value: val } : null;
    } catch (e) {
      return null;
    }
  },
  set: (key, val) => {
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      console.error('Erreur storage', e);
    }
  },
  delete: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  },
};

const SK_CFG = 'eval-cfg-v8';
const SK_YEARS = 'eval-years-v8';
const SK_PENDING = 'eval-pending-v1';
const skUes = (id) => 'eval-ues-v8-' + id;
const skResp = (id) => 'eval-resp-v8-' + id;
const draftKey = (yearId, ueId, cn) =>
  'eval-draft-' + yearId + '-' + ueId + '-' + cn.slice(0, 30);

const readLocalJson = (key, fallback) => {
  const row = localStore.get(key);
  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
};

const writeLocalJson = (key, value) => localStore.set(key, JSON.stringify(value));
const readPendingQueue = () => readLocalJson(SK_PENDING, []);
const writePendingQueue = (queue) => {
  if (queue.length) writeLocalJson(SK_PENDING, queue);
  else localStore.delete(SK_PENDING);
};

/* ─── Defaults ──────────────────────────────────────────── */
const DEFAULT_YEARS = [
  { id: 'y1', name: 'DFGSM1', sub: '1ère année' },
  { id: 'y2', name: 'DFGSM2', sub: '2ème année' },
  { id: 'y3', name: 'DFGSM3', sub: '3ème année' },
  { id: 'y4', name: 'DFASM1', sub: '4ème année' },
  { id: 'y5', name: 'DFASM2', sub: '5ème année' },
  { id: 'y6', name: 'DFASM3', sub: '6ème année' },
];
const DEFAULT_LQ = [
  { id: 'q1', short: 'Pédagogie', label: 'Qualité pédagogique globale' },
  { id: 'q2', short: 'Objectifs', label: "Clarté des objectifs d'apprentissage" },
  { id: 'q3', short: 'Cohérence', label: 'Adéquation contenu / objectifs' },
  { id: 'q4', short: 'Supports', label: 'Qualité des supports de cours' },
  {
    id: 'q5',
    short: 'Enseignant',
    label: "Disponibilité et investissement de l'enseignant",
  },
  { id: 'q6', short: 'EDN', label: 'Pertinence pour les épreuves nationales (EDN)' },
];
const DEFAULT_YNQ = [
  { id: 'y1q', label: 'Les objectifs étaient clairement annoncés dès le début' },
  {
    id: 'y2q',
    label: "J'avais suffisamment de ressources pour travailler en autonomie",
  },
  { id: 'y3q', label: 'Le volume de travail demandé était raisonnable' },
  { id: 'y4q', label: 'Je recommanderais ce cours' },
];
const DEFAULT_TQ = [
  { id: 't1', label: 'Points forts', ph: "Ce que j'ai particulièrement apprécié…" },
  { id: 't2', label: 'Points à améliorer', ph: "Ce qui mériterait d'être revu…" },
  { id: 't3', label: 'Suggestions libres', ph: 'Toute autre remarque ou suggestion…' },
];
const DEFAULT_CFG = {
  pin: '1234',
  globalLQ: DEFAULT_LQ,
  globalYNQ: DEFAULT_YNQ,
  globalTQ: DEFAULT_TQ,
};

/* ─── Scale 1-10 ─────────────────────────────────────────── */
const SCALE_COLORS = [
  null,
  '#b91c1c',
  '#dc2626',
  '#ea580c',
  '#f97316',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#059669',
  '#047857',
];
const SCALE_LABELS = [
  null,
  'Très insuf.',
  'Très insuf.',
  'Insuffisant',
  'Insuffisant',
  'Moyen',
  'Correct',
  'Bien',
  'Bien',
  'Excellent',
  'Excellent',
];
const YEAR_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

/* ─── Utils ──────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 9);
const mkId = (p) => p + '_' + uid();
const normC = (c) => (typeof c === 'string' ? { name: c, enseignant: '' } : c);
const cN = (c) => (typeof c === 'string' ? c : c.name);
const cE = (c) => (typeof c === 'string' ? '' : c.enseignant || '');
const mkForm = (lq, ynq, tq) => ({
  ...Object.fromEntries(lq.map((q) => [q.id, 0])),
  ...Object.fromEntries(ynq.map((q) => [q.id, null])),
  ...Object.fromEntries(tq.map((q) => [q.id, ''])),
});
const getQ = (ue, cfg) => ({
  lq: ue.customQ ? ue.customQ.lq : cfg.globalLQ,
  ynq: ue.customQ ? ue.customQ.ynq : cfg.globalYNQ,
  tq: ue.customQ ? ue.customQ.tq : cfg.globalTQ,
});
const avg = (rs, qid) => {
  const v = rs.map((r) => r[qid]).filter((x) => x > 0);
  return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : 0;
};
const countResponses = (responseMap = {}) =>
  Object.values(responseMap).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
const ynPct = (rs, qid) => {
  const v = rs.map((r) => r[qid]).filter((x) => x !== null);
  return v.length ? Math.round((v.filter(Boolean).length / v.length) * 100) : null;
};
const gAvg = (rs, lq) =>
  rs.length ? +(lq.reduce((s, q) => s + avg(rs, q.id), 0) / lq.length).toFixed(1) : null;
const sCol = (v) => {
  if (!v || v === 0) return '#94a3b8';
  if (v >= 8) return '#059669';
  if (v >= 6) return '#2563eb';
  if (v >= 4) return '#f97316';
  return '#dc2626';
};
const pCol = (p) => {
  if (p == null) return '#94a3b8';
  if (p >= 70) return '#059669';
  if (p >= 40) return '#f97316';
  return '#dc2626';
};
const mergePendingCounts = (baseCounts, years, queue) => {
  const merged = Object.fromEntries(years.map((year) => [year.id, baseCounts?.[year.id] || 0]));
  queue.forEach((item) => {
    merged[item.yearId] = (merged[item.yearId] || 0) + 1;
  });
  return merged;
};
const mergePendingIntoResponses = (responseMap, yearId, queue) => {
  const merged = Object.fromEntries(
    Object.entries(responseMap || {}).map(([key, rows]) => [key, Array.isArray(rows) ? [...rows] : []])
  );
  queue.forEach((item) => {
    if (item.yearId !== yearId) return;
    const key = item.ueId + '::' + item.courseName;
    merged[key] = [...(merged[key] || []), item.response];
  });
  return merged;
};
const computeLocalYearCounts = (years) =>
  Object.fromEntries(years.map((year) => [year.id, countResponses(readLocalJson(skResp(year.id), {}))]));
const dlFile = (content, filename, mime) => {
  const a = document.createElement('a');
  a.href = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(content);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
const parseImport = (raw) => {
  if (!raw.trim()) return null;
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'));
  const res = {};
  lines.forEach((line) => {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const cols = line
      .split(sep)
      .map((c) => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 2) return;
    const ueName = cols[0];
    const coursN = cols[1];
    const ens = cols[2] || '';
    if (!ueName || !coursN) return;
    if (!res[ueName]) res[ueName] = [];
    if (!res[ueName].find((c) => c.name === coursN)) {
      res[ueName].push({ name: coursN, enseignant: ens.trim() });
    }
  });
  return Object.entries(res).map(([ueName, cours]) => ({ ueName, cours }));
};

/* ─── PDF Export ─────────────────────────────────────────── */
const exportPDF = (ue, yearName, cfg, getRespFor) => {
  const { lq, ynq, tq } = getQ(ue, cfg);
  const allResps = ue.cours.flatMap((c) => getRespFor(ue.id, cN(c)));
  const n = allResps.length;
  const ga = gAvg(allResps, lq);
  const rec = ynPct(allResps, 'y4q');
  const sc = (v) =>
    v >= 8 ? '#059669' : v >= 6 ? '#1d4ed8' : v >= 4 ? '#ea580c' : '#dc2626';
  const pctW = (v) => Math.round((v / 10) * 100) + '%';

  let courseHTML = '';
  ue.cours.forEach((c) => {
    const r = getRespFor(ue.id, cN(c));
    const cga = gAvg(r, lq);
    let rows = '';
    lq.forEach((q) => {
      const v = avg(r, q.id);
      rows +=
        '<tr><td>' +
        q.label +
        '</td><td style="text-align:center;font-weight:600;color:' +
        sc(v) +
        '">' +
        (v > 0 ? v.toFixed(1) + ' /10' : '–') +
        '</td><td><div style="background:#f1f5f9;height:6px;border-radius:3px"><div style="width:' +
        (v > 0 ? pctW(v) : '0%') +
        ';height:6px;background:' +
        sc(v) +
        ';border-radius:3px"></div></div></td></tr>';
    });
    let ynRows = '';
    ynq.forEach((q) => {
      const p = ynPct(r, q.id);
      ynRows +=
        '<tr><td>' +
        q.label +
        '</td><td style="text-align:center;font-weight:600;color:' +
        pCol(p) +
        '">' +
        (p != null ? p + '%' : '–') +
        '</td></tr>';
    });
    let comments = '';
    tq.forEach((q) => {
      const texts = r.map((rr) => rr[q.id]).filter((t) => t && t.trim());
      comments +=
        '<div style="margin-top:12px"><p style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:600;margin:0 0 6px">' +
        q.label +
        '</p>';
      if (texts.length === 0) {
        comments += '<p style="font-size:13px;color:#94a3b8;margin:0">Aucun commentaire</p>';
      } else {
        texts.forEach((t) => {
          comments +=
            '<div style="border-left:3px solid #cbd5e1;padding:8px 12px;margin:4px 0;font-size:13px;font-style:italic;color:#475569">' +
            t +
            '</div>';
        });
      }
      comments += '</div>';
    });
    const cgaColor = cga ? sc(parseFloat(cga)) : '#94a3b8';
    courseHTML +=
      '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:18px;page-break-inside:avoid"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px"><div><div style="font-size:16px;font-weight:700;color:#1a2744">' +
      cN(c) +
      '</div>' +
      (cE(c)
        ? '<div style="font-size:12px;color:#94a3b8;margin-top:2px">' + cE(c) + '</div>'
        : '') +
      '</div><div style="text-align:right"><div style="font-size:22px;font-weight:700;color:' +
      cgaColor +
      '">' +
      (cga
        ? cga + '<span style="font-size:14px;font-weight:400;color:#64748b"> /10</span>'
        : '–') +
      '</div><div style="font-size:13px;color:#94a3b8">' +
      r.length +
      ' réponse' +
      (r.length !== 1 ? 's' : '') +
      '</div></div></div>' +
      (r.length === 0
        ? '<p style="color:#94a3b8;font-size:13px;padding:8px 0">Aucune réponse pour ce cours</p>'
        : '<table>' +
          rows +
          '</table><p style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:600;margin:14px 0 6px">Questions Oui / Non</p><table>' +
          ynRows +
          '</table>' +
          comments) +
      '</div>';
  });

  let overviewRows = '';
  ue.cours.forEach((c) => {
    const r = getRespFor(ue.id, cN(c));
    const g = gAvg(r, lq);
    overviewRows +=
      '<tr><td>' +
      cN(c) +
      '</td><td>' +
      (cE(c) || '–') +
      '</td><td style="text-align:center">' +
      r.length +
      '</td><td style="text-align:center;font-weight:700;color:' +
      (g ? sc(parseFloat(g)) : '#94a3b8') +
      '">' +
      (g ? g + ' /10' : '–') +
      '</td></tr>';
  });

  const html =
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Rapport ' +
    ue.name +
    ' - ' +
    yearName +
    '</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Segoe UI",Arial,sans-serif;color:#0f172a;max-width:860px;margin:0 auto;padding:28px;background:#fff;font-size:14px;line-height:1.6}h1{font-size:26px;font-weight:700;color:#1a2744;margin-bottom:4px}h2{font-size:17px;font-weight:700;color:#1a2744;margin:28px 0 12px;border-bottom:2px solid #f4f1eb;padding-bottom:7px}.kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}.kpi{background:#f4f1eb;border-radius:8px;padding:14px 16px}.kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:4px;font-weight:600}.kpi-value{font-size:28px;font-weight:700}table{width:100%;border-collapse:collapse;margin:10px 0 16px;font-size:13px}th{background:#1a2744;color:#fff;padding:8px 12px;text-align:left;font-weight:500;font-size:12px}td{padding:7px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}.pbar{background:#1a2744;color:#fff;padding:11px 18px;border-radius:8px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between}.pbtn{background:#fff;color:#1a2744;border:none;padding:6px 14px;border-radius:6px;font-weight:700;cursor:pointer}@media print{.pbar{display:none}}</style></head><body><div class="pbar"><span>Ouvrez dans votre navigateur · Ctrl+P pour enregistrer en PDF</span><button class="pbtn" onclick="window.print()">Imprimer / PDF</button></div><h1>' +
    ue.name +
    '</h1><p style="font-size:13px;color:#94a3b8;margin-bottom:24px">' +
    yearName +
    ' · Généré le ' +
    new Date().toLocaleDateString('fr-FR') +
    ' · ' +
    ue.cours.length +
    ' cours</p><div class="kpi-row"><div class="kpi"><div class="kpi-label">Réponses collectées</div><div class="kpi-value" style="color:#1a2744">' +
    n +
    '<span style="font-size:13px;font-weight:400;color:#64748b"> rép.</span></div></div><div class="kpi"><div class="kpi-label">Score moyen global</div><div class="kpi-value" style="color:' +
    (ga ? sc(parseFloat(ga)) : '#94a3b8') +
    '">' +
    (ga || '–') +
    '<span style="font-size:13px;font-weight:400;color:#64748b">' +
    (ga ? ' /10' : '') +
    '</span></div></div><div class="kpi"><div class="kpi-label">Taux de recommandation</div><div class="kpi-value" style="color:' +
    pCol(rec) +
    '">' +
    (rec != null ? rec : '–') +
    '<span style="font-size:13px;font-weight:400;color:#64748b">' +
    (rec != null ? '%' : '') +
    '</span></div></div></div>' +
    (n > 0
      ? "<h2>Vue d'ensemble des cours</h2><table><tr><th>Cours</th><th>Enseignant</th><th>Réponses</th><th>Score /10</th></tr>" +
        overviewRows +
        '</table>'
      : '') +
    '<h2>Détail par cours</h2>' +
    courseHTML +
    '</body></html>';
  dlFile(
    html,
    'rapport_' + ue.name.replace(/\s/g, '_') + '_' + yearName + '.html',
    'text/html'
  );
};

/* ─── CSS ────────────────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=Lora:ital@1&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f4f1eb;--bg2:#ece8e0;--sf:#fff;
  --navy:#1a2744;--navy2:#243461;--blue:#2563eb;
  --green:#059669;--amber:#d97706;--red:#dc2626;
  --txt:#0f172a;--txt2:#475569;--txt3:#94a3b8;
  --bdr:rgba(15,23,42,.1);--bdr2:rgba(15,23,42,.18);
  --sh:0 1px 3px rgba(15,23,42,.08),0 4px 16px rgba(15,23,42,.06);
  --shm:0 2px 8px rgba(15,23,42,.1),0 8px 32px rgba(15,23,42,.08);
}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--txt)}
.app{min-height:100vh;background:var(--bg)}
.page{max-width:780px;margin:0 auto;padding:0 20px 64px}
.page-lg{max-width:960px;margin:0 auto;padding:0 20px 64px}
.topbar{position:sticky;top:0;z-index:100;background:rgba(244,241,235,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--bdr);padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.tb-title{font-size:15px;font-weight:600;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-sub{font-size:12px;color:var(--txt3);margin-top:1px}
.tb-right{display:flex;gap:8px;align-items:center;flex-shrink:0}
.sync-chip{display:inline-flex;align-items:center;justify-content:center;min-width:68px;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid var(--bdr2);background:var(--sf);color:var(--txt2)}
.sync-chip.ok{background:rgba(5,150,105,.1);border-color:rgba(5,150,105,.18);color:var(--green)}
.sync-chip.warn{background:rgba(217,119,6,.12);border-color:rgba(217,119,6,.2);color:var(--amber)}
.sync-chip.off{background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.16);color:var(--red)}
.hero{text-align:center;padding:52px 0 36px}
.hero-ey{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--blue);margin-bottom:14px}
.hero-h1{font-size:clamp(26px,5vw,40px);font-weight:600;color:var(--navy);line-height:1.15;margin-bottom:10px}
.hero-h1 em{font-family:'Lora',serif;font-style:italic;font-weight:400;color:var(--blue)}
.hero-sub{font-size:15px;color:var(--txt2);font-weight:300}
.yr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:700px;margin:0 auto 24px}
@media(max-width:560px){.yr-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:360px){.yr-grid{grid-template-columns:1fr}}
.yr-card{background:var(--sf);border:1.5px solid var(--bdr);border-radius:16px;padding:22px 16px 18px;cursor:pointer;text-align:center;transition:all .18s ease;box-shadow:var(--sh)}
.yr-card:hover{border-color:var(--blue);box-shadow:var(--shm);transform:translateY(-2px)}
.yr-name{font-size:20px;font-weight:600;color:var(--navy);margin-bottom:3px}
.yr-sub{font-size:12px;color:var(--txt2);margin-bottom:12px}
.yr-badge{display:inline-block;font-size:11px;padding:2px 10px;border-radius:20px;background:var(--bg2);color:var(--txt3)}
.yr-badge.has{background:rgba(37,99,235,.1);color:var(--blue)}
.ac-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:520px;margin:0 auto 24px}
@media(max-width:440px){.ac-grid{grid-template-columns:1fr}}
.ac-card{background:var(--sf);border:1.5px solid var(--bdr);border-radius:16px;padding:26px 20px;cursor:pointer;text-align:center;transition:all .18s ease;box-shadow:var(--sh)}
.ac-card:hover{border-color:var(--navy);box-shadow:var(--shm);transform:translateY(-2px)}
.ac-icon{font-size:26px;margin-bottom:10px;display:block}
.ac-title{font-size:15px;font-weight:600;color:var(--navy);margin-bottom:4px}
.ac-sub{font-size:12px;color:var(--txt3)}
.card{background:var(--sf);border:1px solid var(--bdr);border-radius:16px;padding:22px 24px;margin-bottom:14px;box-shadow:var(--sh)}
.card-muted{background:var(--bg2);border-color:transparent;box-shadow:none}
.card-title{font-size:15px;font-weight:600;color:var(--navy);margin-bottom:4px}
.card-sub{font-size:13px;color:var(--txt2);margin-bottom:18px;line-height:1.5}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
@media(max-width:480px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
.stat-tile{background:var(--bg2);border-radius:10px;padding:14px 16px}
.stat-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--txt3);margin-bottom:4px;font-weight:600}
.stat-val{font-size:24px;font-weight:700;color:var(--navy);line-height:1}
.stat-unit{font-size:12px;font-weight:400;color:var(--txt2)}
.ue-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
@media(max-width:520px){.ue-grid{grid-template-columns:1fr}}
.ue-tile{background:var(--bg2);border-radius:10px;padding:12px 14px}
.ue-name{font-size:13px;font-weight:600;color:var(--navy);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.cr-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--bdr)}
.cr-row:last-child{border-bottom:none}
.cr-bdg{font-size:11px;padding:1px 8px;border-radius:10px;white-space:nowrap;background:var(--bg);border:1px solid var(--bdr);color:var(--txt3)}
.cr-bdg.has{background:rgba(37,99,235,.08);border-color:rgba(37,99,235,.15);color:var(--blue)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 20px;border-radius:10px;border:none;font-size:14px;font-weight:500;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif;white-space:nowrap}
.btn:disabled{background:#e2e8f0;color:var(--txt3);cursor:default}
.btn-navy{background:var(--navy);color:#fff}.btn-navy:hover:not(:disabled){background:var(--navy2)}
.btn-green{background:var(--green);color:#fff}.btn-green:hover:not(:disabled){background:#047857}
.btn-danger{background:#fee2e2;color:var(--red)}.btn-danger:hover{background:#fecaca}
.btn-ghost{background:transparent;border:1px solid var(--bdr2);color:var(--txt2)}.btn-ghost:hover{background:var(--bg2);color:var(--navy)}
.btn-sm{padding:5px 12px;font-size:12px;border-radius:7px}
.pill{padding:5px 13px;border-radius:20px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid var(--bdr2);background:var(--sf);color:var(--txt2);transition:all .14s;white-space:nowrap;font-family:'DM Sans',sans-serif}
.pill:hover{border-color:var(--navy);color:var(--navy)}
.pill.p-navy{background:var(--navy);color:#fff;border-color:var(--navy)}
.pill.p-blue{background:var(--blue);color:#fff;border-color:var(--blue)}
.pill.p-green{background:var(--green);color:#fff;border-color:var(--green)}
.pill.p-red{background:var(--red);color:#fff;border-color:var(--red)}
.pick-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:18px}
@media(max-width:480px){.pick-grid{grid-template-columns:1fr}}
.pick-item{border:1.5px solid var(--bdr2);border-radius:10px;padding:13px 15px;cursor:pointer;transition:all .14s;background:var(--sf)}
.pick-item:hover,.pick-item.sel{border-color:var(--blue)}
.pick-item.sel{background:rgba(37,99,235,.06)}
.pick-main{font-size:14px;font-weight:500;color:var(--navy);margin-bottom:2px}
.pick-main.sel{color:var(--blue)}
.pick-sub{font-size:12px;color:var(--txt3)}
.pick-list{display:flex;flex-direction:column;gap:6px;margin-bottom:18px}
.pick-li{border:1.5px solid var(--bdr2);border-radius:10px;padding:12px 16px;cursor:pointer;transition:all .14s;background:var(--sf);display:flex;justify-content:space-between;align-items:center;gap:12px}
.pick-li:hover,.pick-li.sel{border-color:var(--blue)}
.pick-li.sel{background:rgba(37,99,235,.06)}
.prog-track{height:3px;background:var(--bg2);border-radius:2px;margin-bottom:22px;overflow:hidden}
.prog-fill{height:100%;background:var(--blue);border-radius:2px;transition:width .35s}
.l10-grid{display:flex;gap:5px;align-items:center}
@media(max-width:520px){.l10-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}}
.l10-btn{flex:1;min-width:0;height:44px;border-radius:9px;border:1.5px solid var(--bdr2);font-size:15px;font-weight:600;cursor:pointer;transition:all .14s;background:var(--sf);color:var(--txt2);font-family:'DM Sans',sans-serif}
.l10-btn:hover{border-color:var(--navy);transform:translateY(-1px)}
.l10-btn.sel{border-color:transparent;color:#fff;transform:scale(1.06)}
.yn-pair{display:flex;gap:10px}
.yn-btn{flex:1;padding:10px 0;border-radius:10px;border:1.5px solid var(--bdr2);font-size:14px;font-weight:500;cursor:pointer;transition:all .14s;background:var(--sf);color:var(--txt2);font-family:'DM Sans',sans-serif}
.yn-btn:hover{border-color:var(--navy)}
.yn-yes{border-color:var(--green);background:rgba(5,150,105,.08);color:var(--green)}
.yn-no{border-color:var(--red);background:rgba(220,38,38,.07);color:var(--red)}
.inp{width:100%;padding:9px 12px;border-radius:10px;outline:none;border:1.5px solid var(--bdr2);font-size:14px;font-family:'DM Sans',sans-serif;background:var(--bg2);color:var(--txt);transition:border-color .14s;box-sizing:border-box}
.inp:focus{border-color:var(--blue);background:var(--sf)}
.inp-sm{padding:7px 10px;font-size:13px}
.inp-mono{font-family:monospace;font-size:13px}
.txa{width:100%;padding:11px 14px;border-radius:10px;resize:vertical;border:1.5px solid var(--bdr2);font-size:14px;font-family:'DM Sans',sans-serif;background:var(--bg2);color:var(--txt);outline:none;transition:border-color .14s;line-height:1.6}
.txa:focus{border-color:var(--blue);background:var(--sf)}
.subtab-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--bg2);border-radius:10px;padding:8px 12px;margin-bottom:16px}
.cmt-quote{border-left:3px solid var(--bdr2);padding-left:12px;margin-bottom:8px;font-size:14px;color:var(--txt);line-height:1.65;font-style:italic}
.t-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px}
.t-card{background:var(--sf);border:1.5px solid var(--bdr);border-radius:16px;padding:16px 18px;cursor:pointer;transition:all .15s;box-shadow:var(--sh)}
.t-card:hover,.t-card.sel{border-color:var(--blue);box-shadow:var(--shm)}
.cy-btn{padding:7px 16px;border-radius:10px;border:1.5px solid var(--bdr2);font-size:13px;font-weight:500;cursor:pointer;background:var(--sf);transition:all .14s}
.cy-btn.act{background:var(--navy);color:#fff}
.str-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--bdr)}
.modal-ov{position:fixed;inset:0;background:rgba(10,17,40,.55);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px)}
.modal-box{background:var(--sf);border-radius:24px;padding:36px 32px;width:100%;max-width:320px;text-align:center}
.pin-inp{width:100%;text-align:center;font-size:28px;letter-spacing:10px;padding:10px;border-radius:10px;border:2px solid var(--bdr2);background:var(--bg2)}
.done-wrap{text-align:center;padding:56px 32px}
.done-chk{width:60px;height:60px;border-radius:50%;background:rgba(5,150,105,.1);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:26px;color:var(--green)}
.slbl{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--txt3);margin-bottom:10px}
.badge-p{font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(217,119,6,.1);color:var(--amber);font-weight:600}
.yr-sel-bar{background:var(--sf);border:1px solid var(--bdr);border-radius:16px;padding:14px 20px;margin-bottom:14px}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.fu{animation:fadeUp .25s ease both}
.empty{text-align:center;padding:52px 32px}
.pill-row{display:flex;gap:6px;flex-wrap:wrap}
code{font-family:monospace;font-size:12px;background:var(--bg2);padding:2px 6px;border-radius:4px}
.sbar-row{margin-bottom:13px}
.sbar-hdr{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}
.sbar-name{font-size:13px;color:var(--txt)}
.sbar-ens{font-size:11px;color:var(--txt3);margin-left:6px}
.sbar-val{font-size:13px;font-weight:700}
.sbar-track{height:6px;border-radius:3px;background:var(--bg2);overflow:hidden}
.sbar-fill{height:100%;border-radius:3px;transition:width .5s}
.sync-note{font-size:12px;color:var(--txt3);margin-bottom:14px}
`;

/* ══════════════════════════════════════════════════════════ */
export default function App() {
  const [years, setYears] = useState(DEFAULT_YEARS);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [loading, setLoading] = useState(true);
  const [loadingYear, setLoadingYear] = useState(false);
  const [selYear, setSelYear] = useState(null);
  const [ues, setUes] = useState([]);
  const [responses, setResponses] = useState({});
  const [view, setView] = useState('yearPick');
  const [syncMode, setSyncMode] = useState('syncing');
  const [syncNote, setSyncNote] = useState('Connexion au serveur...');
  const [pendingCount, setPendingCount] = useState(0);

  // Modals & States
  const [pinModal, setPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [coordPin, setCoordPin] = useState('');
  const pinRef = useRef();
  const [qrModal, setQrModal] = useState(false);
  const [qrReady, setQrReady] = useState(false);
  const qrRef = useRef();

  // Survey
  const [step, setStep] = useState('pickUE');
  const [selUE, setSelUE] = useState(null);
  const [selCours, setSelCours] = useState(null);
  const [form, setForm] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Dashboard
  const [dashView, setDashView] = useState('cours');
  const [dashUEIdx, setDashUEIdx] = useState(0);
  const [dashMode, setDashMode] = useState('ue');
  const [dashCIdx, setDashCIdx] = useState(0);
  const [selTeacher, setSelTeacher] = useState(null);
  const [crossData, setCrossData] = useState({});
  const [crossLoading, setCrossLoading] = useState(false);
  const [crossUEName, setCrossUEName] = useState(null);

  // Settings
  const [stab, setStab] = useState('import');
  const [editUEId, setEditUEId] = useState(null);
  const [editQId, setEditQId] = useState(null);
  const [newUEName, setNewUEName] = useState('');
  const [newCName, setNewCName] = useState('');
  const [newCEns, setNewCEns] = useState('');
  const [newPin1, setNewPin1] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [pinOK, setPinOK] = useState(false);
  const [pinSaveError, setPinSaveError] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [newLQLabel, setNewLQLabel] = useState('');
  const [newLQShort, setNewLQShort] = useState('');
  const [newYNLabel, setNewYNLabel] = useState('');
  const [newYrName, setNewYrName] = useState('');
  const [impText, setImpText] = useState('');
  const [impMode, setImpMode] = useState('merge');
  const [impDone, setImpDone] = useState(false);
  const [yrCounts, setYrCounts] = useState({});

  // CSS
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  // QR Lib
  useEffect(() => {
    if (document.getElementById('qrcode-script')) {
      setQrReady(true);
      return;
    }
    const s = document.createElement('script');
    s.id = 'qrcode-script';
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js';
    s.onload = () => setQrReady(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!qrModal || !qrReady || !qrRef.current) return;
    qrRef.current.innerHTML = '';
    const canvas = document.createElement('canvas');
    qrRef.current.appendChild(canvas);
    if (window.QRCode) {
      window.QRCode.toCanvas(canvas, window.location.href, {
        width: 220,
        margin: 2,
        color: { dark: '#1a2744', light: '#f4f1eb' },
      });
    }
  }, [qrModal, qrReady]);

  const markServerSynced = useCallback((note = 'Persistance serveur active.') => {
    setSyncMode('server');
    setSyncNote(note);
  }, []);

  const markLocalFallback = useCallback((note = 'Serveur indisponible, mode local actif.') => {
    setSyncMode('local');
    setSyncNote(note);
  }, []);

  const flushPendingResponses = useCallback(async () => {
    const queue = readPendingQueue();
    setPendingCount(queue.length);
    if (!queue.length) return 0;

    const remaining = [];
    let synced = 0;
    for (const item of queue) {
      try {
        await api.appendResponse(item.yearId, item.ueId, item.courseName, item.response);
        synced += 1;
      } catch {
        remaining.push(item);
      }
    }

    writePendingQueue(remaining);
    setPendingCount(remaining.length);

    if (synced > 0) {
      if (remaining.length) {
        markLocalFallback(`${remaining.length} réponse(s) restent en attente de synchronisation.`);
      } else {
        markServerSynced('Toutes les réponses locales ont été synchronisées.');
      }
    }

    return synced;
  }, [markLocalFallback, markServerSynced]);

  // Load Init
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const localCfg = readLocalJson(SK_CFG, DEFAULT_CFG);
      const localYears = readLocalJson(SK_YEARS, DEFAULT_YEARS);
      const pendingQueue = readPendingQueue();
      setPendingCount(pendingQueue.length);

      try {
        const boot = await api.getBootstrap();
        const nextCfg = boot.hasConfig ? boot.config : localCfg;
        const nextYears = boot.hasYears ? boot.years : localYears;

        if (cancelled) return;
        setCfg(nextCfg || DEFAULT_CFG);
        setYears(nextYears || DEFAULT_YEARS);
        writeLocalJson(SK_CFG, nextCfg || DEFAULT_CFG);
        writeLocalJson(SK_YEARS, nextYears || DEFAULT_YEARS);
        setYrCounts(
          mergePendingCounts(boot.responseCounts || {}, nextYears || DEFAULT_YEARS, pendingQueue)
        );
        markServerSynced('Persistance serveur active.');

        if (!boot.hasConfig && api.mode !== 'supabase') {
          void api.putConfig(nextCfg || DEFAULT_CFG).catch(() => {});
        }
        if (!boot.hasYears && api.mode !== 'supabase') {
          void api.putYears(nextYears || DEFAULT_YEARS).catch(() => {});
        }
        void flushPendingResponses();
      } catch {
        if (cancelled) return;
        const nextCfg = localCfg || DEFAULT_CFG;
        const nextYears = localYears || DEFAULT_YEARS;
        setCfg(nextCfg);
        setYears(nextYears);
        setYrCounts(computeLocalYearCounts(nextYears));
        markLocalFallback('Serveur indisponible, mode local actif.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [flushPendingResponses, markLocalFallback, markServerSynced]);

  // Load Data by Year
  useEffect(() => {
    if (!selYear) return;
    let cancelled = false;

    const loadYear = async () => {
      const localUesRaw = readLocalJson(skUes(selYear.id), []);
      const localResponses = readLocalJson(skResp(selYear.id), {});
      const pendingQueue = readPendingQueue();
      setPendingCount(pendingQueue.length);
      setLoadingYear(true);

      try {
        const remote = await api.getYearData(selYear.id);
        const rawUes = remote.exists ? remote.ues : localUesRaw;
        const nextResponses = remote.exists
          ? mergePendingIntoResponses(remote.responses || {}, selYear.id, pendingQueue)
          : localResponses;

        if (cancelled) return;
        setUes((rawUes || []).map((u) => ({ ...u, cours: u.cours.map(normC) })));
        setResponses(nextResponses || {});
        setYrCounts((prev) => ({ ...prev, [selYear.id]: countResponses(nextResponses || {}) }));
        writeLocalJson(skUes(selYear.id), rawUes || []);
        writeLocalJson(skResp(selYear.id), nextResponses || {});
        markServerSynced('Données chargées depuis le serveur.');

        if (!remote.exists && (localUesRaw.length || Object.keys(localResponses).length)) {
          if (api.mode !== 'supabase' || coordPin) {
            void api
              .putYearSnapshot(selYear.id, { ues: localUesRaw, responses: localResponses }, coordPin)
              .catch(() => {});
          }
        }
        void flushPendingResponses();
      } catch {
        if (cancelled) return;
        setUes(localUesRaw.map((u) => ({ ...u, cours: u.cours.map(normC) })));
        setResponses(localResponses);
        setYrCounts((prev) => ({ ...prev, [selYear.id]: countResponses(localResponses) }));
        markLocalFallback(`Serveur indisponible, données ${selYear.name} chargées en local.`);
      } finally {
        if (!cancelled) setLoadingYear(false);
      }
    };

    void loadYear();
    return () => {
      cancelled = true;
    };
  }, [coordPin, flushPendingResponses, markLocalFallback, markServerSynced, selYear]);

  // Sync Drafts
  useEffect(() => {
    if (step === 'fill' && selYear && selUE && selCours && Object.keys(form).length > 0) {
      writeLocalJson(draftKey(selYear.id, selUE, cN(selCours)), form);
    }
  }, [form, step, selYear, selUE, selCours]);

  useEffect(() => {
    const handleOnline = () => {
      void flushPendingResponses();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushPendingResponses]);

  // Persistence helpers
  const saveYears = useCallback(
    async (nextYears) => {
      const removedIds = years
        .filter((year) => !nextYears.find((candidate) => candidate.id === year.id))
        .map((year) => year.id);
      const nextQueue = readPendingQueue().filter((item) => !removedIds.includes(item.yearId));

      setYears(nextYears);
      writeLocalJson(SK_YEARS, nextYears);
      removedIds.forEach((yearId) => {
        localStore.delete(skUes(yearId));
        localStore.delete(skResp(yearId));
      });
      writePendingQueue(nextQueue);
      setPendingCount(nextQueue.length);
      setYrCounts((prev) => Object.fromEntries(nextYears.map((year) => [year.id, prev[year.id] || 0])));

      try {
        const result = await api.putYears(nextYears, coordPin);
        setYrCounts(mergePendingCounts(result?.responseCounts || {}, nextYears, nextQueue));
        markServerSynced('Promotions enregistrées sur le serveur.');
      } catch {
        markLocalFallback('Promotions enregistrées localement.');
      }
    },
    [coordPin, markLocalFallback, markServerSynced, years]
  );

  const saveCfg = useCallback(
    async (nextCfg) => {
      setCfg(nextCfg);
      writeLocalJson(SK_CFG, nextCfg);
      try {
        await api.putConfig(nextCfg, coordPin);
        markServerSynced('Configuration enregistrée sur le serveur.');
      } catch {
        markLocalFallback('Configuration enregistrée localement.');
      }
    },
    [coordPin, markLocalFallback, markServerSynced]
  );

  const saveUes = useCallback(
    async (nextUes) => {
      setUes(nextUes);
      if (selYear) writeLocalJson(skUes(selYear.id), nextUes);
      if (!selYear) return;

      try {
        await api.putYearUes(selYear.id, nextUes, coordPin);
        markServerSynced(`Structure ${selYear.name} enregistrée sur le serveur.`);
      } catch {
        markLocalFallback(`Structure ${selYear.name} enregistrée localement.`);
      }
    },
    [coordPin, markLocalFallback, markServerSynced, selYear]
  );

  const getRespFor = useCallback((ueId, cn) => responses[ueId + '::' + cn] || [], [responses]);

  const openSettings = () => {
    setPinInput('');
    setPinError(false);
    setPinModal(true);
    setTimeout(() => pinRef.current?.focus(), 100);
  };
  const tryPin = async () => {
    setPinBusy(true);
    setPinError(false);
    try {
      const ok = await api.verifyPin(pinInput, cfg.pin);
      if (ok) {
        setCoordPin(pinInput);
        setPinModal(false);
        setView('settings');
      } else {
        setPinError(true);
        setPinInput('');
        pinRef.current?.focus();
      }
    } catch {
      setPinError(true);
      setPinInput('');
      pinRef.current?.focus();
    } finally {
      setPinBusy(false);
    }
  };

  const submit = async () => {
    if (!selYear || !selUE || !selCours) return;

    const entry = { ...form, ts: Date.now() };
    const key = selUE + '::' + cN(selCours);
    const updated = { ...responses, [key]: [...(responses[key] || []), entry] };

    setSubmitting(true);
    setResponses(updated);
    writeLocalJson(skResp(selYear.id), updated);
    setYrCounts((prev) => ({ ...prev, [selYear.id]: countResponses(updated) }));

    try {
      await api.appendResponse(selYear.id, selUE, cN(selCours), entry);
      markServerSynced('Réponse enregistrée sur le serveur.');
      void flushPendingResponses();
    } catch {
      const queue = [
        ...readPendingQueue(),
        { yearId: selYear.id, ueId: selUE, courseName: cN(selCours), response: entry },
      ];
      writePendingQueue(queue);
      setPendingCount(queue.length);
      markLocalFallback('Réponse conservée localement en attente du serveur.');
    } finally {
      localStore.delete(draftKey(selYear.id, selUE, cN(selCours)));
      setSubmitting(false);
      setStep('done');
    }
  };

  const exportCSV = () => {
    const aLQ = [...new Set(ues.flatMap((u) => (u.customQ?.lq || cfg.globalLQ).map((q) => q.id)))];
    const aYNQ = [...new Set(ues.flatMap((u) => (u.customQ?.ynq || cfg.globalYNQ).map((q) => q.id)))];
    const aTQ = [...new Set(ues.flatMap((u) => (u.customQ?.tq || cfg.globalTQ).map((q) => q.id)))];
    const hdrs = ['Année', 'UE', 'Cours', 'Enseignant', 'Date', ...aLQ, ...aYNQ, ...aTQ];
    const rows = ues.flatMap((u) =>
      u.cours.flatMap((c) =>
        getRespFor(u.id, cN(c)).map((r) =>
          [
            `"${selYear?.name}"`,
            `"${u.name}"`,
            `"${cN(c)}"`,
            `"${cE(c)}"`,
            new Date(r.ts).toLocaleDateString(),
            ...aLQ.map((id) => r[id] || 0),
            ...aYNQ.map((id) => (r[id] === null ? '' : r[id] ? 'Oui' : 'Non')),
            ...aTQ.map((id) => `"${(r[id] || '').replace(/"/g, '""')}"`),
          ].join(',')
        )
      )
    );
    dlFile([hdrs.join(',')].concat(rows).join('\n'), `evaluations_${selYear?.name}.csv`, 'text/csv');
  };

  const applyImport = async () => {
    const data = parseImport(impText);
    if (!data) return;
    let nu = impMode === 'replace' ? [] : [...ues];
    data.forEach((item) => {
      let ex = nu.find((u) => u.name === item.ueName);
      if (ex) {
        item.cours.forEach((nc) => {
          if (!ex.cours.find((ec) => cN(ec) === nc.name)) ex.cours.push(nc);
        });
      } else {
        nu.push({ id: uid(), name: item.ueName, cours: item.cours, customQ: null });
      }
    });
    await saveUes(nu);
    setImpText('');
    setImpDone(true);
    setTimeout(() => setImpDone(false), 3000);
  };

  const loadCrossData = useCallback(async () => {
    setCrossLoading(true);
    const pendingQueue = readPendingQueue();

    try {
      const entries = await Promise.all(
        years
          .filter((yr) => !selYear || yr.id !== selYear.id)
          .map(async (yr) => {
            const localUesRaw = readLocalJson(skUes(yr.id), []);
            const localResponses = readLocalJson(skResp(yr.id), {});

            try {
              const remote = await api.getYearData(yr.id);
              const rawUes = remote.exists ? remote.ues : localUesRaw;
              const mergedResponses = remote.exists
                ? mergePendingIntoResponses(remote.responses || {}, yr.id, pendingQueue)
                : localResponses;

              writeLocalJson(skUes(yr.id), rawUes || []);
              writeLocalJson(skResp(yr.id), mergedResponses || {});
              return [
                yr.id,
                {
                  year: yr,
                  ues: (rawUes || []).map((x) => ({ ...x, cours: x.cours.map(normC) })),
                  responses: mergedResponses || {},
                },
              ];
            } catch {
              return [
                yr.id,
                {
                  year: yr,
                  ues: localUesRaw.map((x) => ({ ...x, cours: x.cours.map(normC) })),
                  responses: localResponses,
                },
              ];
            }
          })
      );

      setCrossData(Object.fromEntries(entries));
    } finally {
      setCrossLoading(false);
    }
  }, [selYear, years]);

  useEffect(() => {
    if (view === 'dashboard' && dashView === 'interannees') void loadCrossData();
  }, [dashView, view, loadCrossData]);

  /* ── Components ────────────────────────────────────────── */
  const syncLabel =
    pendingCount > 0
      ? `${pendingCount} attente${pendingCount > 1 ? 's' : ''}`
      : syncMode === 'server'
        ? 'Serveur'
        : syncMode === 'local'
          ? 'Local'
          : 'Sync...';
  const syncClass =
    pendingCount > 0 ? 'sync-chip warn' : syncMode === 'server' ? 'sync-chip ok' : 'sync-chip off';

  const SyncBadge = () => (
    <span className={syncClass} title={syncNote}>
      {syncLabel}
    </span>
  );

  const Topbar = ({ title, sub, onBack, extra }) => (
    <div className="topbar">
      <div style={{ minWidth: 0 }}>
        <div className="tb-title">{title}</div>
        {sub && <div className="tb-sub">{sub}</div>}
      </div>
      <div className="tb-right">
        <SyncBadge />
        {extra}
        {onBack && (
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            ←
          </button>
        )}
      </div>
    </div>
  );

  const ScoreBar = ({ label, ens, score, n, showEns }) => (
    <div className="sbar-row">
      <div className="sbar-hdr">
        <div>
          <span className="sbar-name">{label}</span>
          {showEns && ens && <span className="sbar-ens">{ens}</span>}
        </div>
        <span className="sbar-val" style={{ color: n > 0 ? sCol(score) : '#94a3b8' }}>
          {n > 0 ? score.toFixed(1) + '/10' : '–'}
          <span style={{ fontSize: 11, marginLeft: 6, fontWeight: 400 }}>· {n} rép.</span>
        </span>
      </div>
      <div className="sbar-track">
        <div
          className="sbar-fill"
          style={{
            width: n > 0 ? score * 10 + '%' : '0%',
            background: n > 0 ? sCol(score) : '#e2e8f0',
          }}
        />
      </div>
    </div>
  );

  if (loading) return null;

  /* ══ YEAR PICKER ═════════════════════════════════════════ */
  if (view === 'yearPick')
    return (
      <div className="app">
        {pinModal && (
          <div className="modal-ov">
            <div className="modal-box fu">
              <h3>Accès Coordinateur</h3>
              <input
                ref={pinRef}
                type="password"
                value={pinInput}
                className="pin-inp"
                onChange={(e) => setPinInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && tryPin()}
              />
              {pinError && (
                <div style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>
                  PIN invalide ou serveur injoignable.
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button className="btn btn-navy" onClick={tryPin} disabled={pinBusy}>
                  {pinBusy ? 'Vérification...' : 'Valider'}
                </button>
                <button className="btn btn-ghost" onClick={() => setPinModal(false)}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}
        <Topbar
          title="Évaluation des cours"
          extra={
            <button className="btn btn-ghost btn-sm" onClick={openSettings}>
              ⚙ Coordinateur
            </button>
          }
        />
        <div className="page fu">
          <div className="sync-note">{syncNote}</div>
          <div className="hero">
            <div className="hero-ey">Faculté de médecine</div>
            <h1 className="hero-h1">
              Quelle est votre <em>année</em> ?
            </h1>
          </div>
          <div className="yr-grid">
            {years.map((yr) => (
              <div
                key={yr.id}
                className="yr-card"
                onClick={() => {
                  setSelYear(yr);
                  setView('home');
                }}
              >
                <div className="yr-name">{yr.name}</div>
                <div className="yr-sub">{yr.sub}</div>
                <span className="yr-badge">{yrCounts[yr.id] || 0} réponses</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

  /* ══ HOME ════════════════════════════════════════════════ */
  if (view === 'home')
    return (
      <div className="app">
        <Topbar
          title={selYear?.name}
          onBack={() => setView('yearPick')}
          extra={
            <button className="btn btn-ghost btn-sm" onClick={() => setQrModal(true)}>
              📱 QR
            </button>
          }
        />
        {qrModal && (
          <div className="modal-ov" onClick={() => setQrModal(false)}>
            <div className="modal-box fu" onClick={(e) => e.stopPropagation()}>
              <div ref={qrRef} />
              <h3>Lien du questionnaire</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setQrModal(false)}>
                Fermer
              </button>
            </div>
          </div>
        )}
        <div className="page fu">
          <div className="sync-note">
            {loadingYear ? `Chargement de ${selYear?.name}...` : syncNote}
          </div>
          <div className="ac-grid" style={{ marginTop: 30 }}>
            <div
              className="ac-card"
              onClick={() => {
                setStep('pickUE');
                setView('survey');
              }}
            >
              ✏️ Évaluer un cours
            </div>
            <div
              className="ac-card"
              onClick={() => {
                setDashUEIdx(0);
                setView('dashboard');
              }}
            >
              📊 Voir les résultats
            </div>
          </div>
          <div className="card">
            <div className="slbl">Structure {selYear?.name}</div>
            <div className="ue-grid">
              {ues.map((u) => (
                <div key={u.id} className="ue-tile">
                  <div className="ue-name">{u.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {u.cours.length} cours ·{' '}
                    {u.cours.length
                      ? u.cours.reduce((sum, cours) => sum + getRespFor(u.id, cN(cours)).length, 0)
                      : 0}{' '}
                    rép.
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );

  /* ══ SURVEY ══════════════════════════════════════════════ */
  if (view === 'survey') {
    if (step === 'pickUE')
      return (
        <div className="app">
          <Topbar title="Choix UE" onBack={() => setView('home')} />
          <div className="page fu" style={{ paddingTop: 30 }}>
            <div className="pick-grid">
              {ues.map((u) => (
                <div
                  key={u.id}
                  className={'pick-item ' + (selUE === u.id ? 'sel' : '')}
                  onClick={() => setSelUE(u.id)}
                >
                  <div className="pick-main">{u.name}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-navy" disabled={!selUE} onClick={() => setStep('pickCours')}>
              Suivant →
            </button>
          </div>
        </div>
      );
    if (step === 'pickCours') {
      const ue = ues.find((u) => u.id === selUE);
      return (
        <div className="app">
          <Topbar title="Choix Cours" onBack={() => setStep('pickUE')} />
          <div className="page fu" style={{ paddingTop: 30 }}>
            <div className="pick-list">
              {ue?.cours.map((c) => (
                <div
                  key={cN(c)}
                  className={'pick-li ' + (selCours === c ? 'sel' : '')}
                  onClick={() => {
                    setSelCours(c);
                    const q = getQ(ue, cfg);
                    const saved = selYear ? readLocalJson(draftKey(selYear.id, ue.id, cN(c)), null) : null;
                    setForm(saved || mkForm(q.lq, q.ynq, q.tq));
                  }}
                >
                  <div className="pick-main">{cN(c)}</div>
                  <div className="pick-sub">{cE(c)}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-navy" disabled={!selCours} onClick={() => setStep('fill')}>
              Commencer →
            </button>
          </div>
        </div>
      );
    }
    if (step === 'fill') {
      const ue = ues.find((u) => u.id === selUE);
      const { lq, ynq, tq } = getQ(ue, cfg);
      const canSubmit = lq.every((q) => form[q.id] > 0) && ynq.every((q) => form[q.id] !== null);
      return (
        <div className="app">
          <Topbar title={cN(selCours)} onBack={() => setStep('pickCours')} />
          <div className="page fu">
            <div className="card">
              {lq.map((q) => (
                <div key={q.id} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, marginBottom: 10 }}>{q.label}</div>
                  <div className="l10-grid">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                      <button
                        key={v}
                        className={'l10-btn ' + (form[q.id] === v ? 'sel' : '')}
                        style={
                          form[q.id] === v
                            ? { background: SCALE_COLORS[v], borderColor: SCALE_COLORS[v] }
                            : {}
                        }
                        onClick={() => setForm({ ...form, [q.id]: v })}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              {ynq.map((q) => (
                <div key={q.id} style={{ marginBottom: 15 }}>
                  <div style={{ fontSize: 14, marginBottom: 8 }}>{q.label}</div>
                  <div className="yn-pair">
                    <button
                      className={'yn-btn ' + (form[q.id] === true ? 'yn-yes' : '')}
                      onClick={() => setForm({ ...form, [q.id]: true })}
                    >
                      Oui
                    </button>
                    <button
                      className={'yn-btn ' + (form[q.id] === false ? 'yn-no' : '')}
                      onClick={() => setForm({ ...form, [q.id]: false })}
                    >
                      Non
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              {tq.map((q) => (
                <div key={q.id} style={{ marginBottom: 15 }}>
                  <div style={{ fontSize: 14, marginBottom: 5 }}>{q.label}</div>
                  <textarea
                    className="txa"
                    rows={3}
                    value={form[q.id] || ''}
                    onChange={(e) => setForm({ ...form, [q.id]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <button
              className="btn btn-green"
              disabled={!canSubmit || submitting}
              onClick={submit}
              style={{ width: '100%', padding: 18 }}
            >
              {submitting ? 'Envoi...' : '✓ Envoyer'}
            </button>
          </div>
        </div>
      );
    }
    if (step === 'done')
      return (
        <div className="app">
          <div className="page fu">
            <div className="card done-wrap">
              <div className="done-chk">✓</div>
              <h2>Merci !</h2>
              <button className="btn btn-navy" onClick={() => setView('home')}>
                Retour
              </button>
            </div>
          </div>
        </div>
      );
  }

  /* ══ DASHBOARD ═══════════════════════════════════════════ */
  if (view === 'dashboard') {
    const activeUE = ues[dashUEIdx];
    const renderDash = () => {
      if (!activeUE) return null;
      const { lq, ynq, tq } = getQ(activeUE, cfg);
      const allR = activeUE.cours.flatMap((c) => getRespFor(activeUE.id, cN(c)));
      const activeR =
        dashMode === 'ue' ? allR : getRespFor(activeUE.id, cN(activeUE.cours[dashCIdx]));
      const radarData = lq.map((q) => ({ subject: q.short, value: avg(activeR, q.id) }));
      return (
        <>
          <div className="pill-row" style={{ marginBottom: 15 }}>
            {ues.map((u, i) => (
              <button
                key={u.id}
                className={'pill ' + (dashUEIdx === i ? 'p-navy' : '')}
                onClick={() => setDashUEIdx(i)}
              >
                {u.name}
              </button>
            ))}
          </div>
          <div className="subtab-bar">
            <button
              className={'pill ' + (dashMode === 'ue' ? 'p-green' : '')}
              onClick={() => setDashMode('ue')}
            >
              Vue UE
            </button>
            {activeUE.cours.map((c, i) => (
              <button
                key={i}
                className={'pill ' + (dashMode === 'cours' && dashCIdx === i ? 'p-blue' : '')}
                onClick={() => {
                  setDashMode('cours');
                  setDashCIdx(i);
                }}
              >
                {cN(c)}
              </button>
            ))}
          </div>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="stat-lbl">Réponses</div>
              <div className="stat-val">{activeR.length}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-lbl">Score Moyen</div>
              <div className="stat-val">{gAvg(activeR, lq) || '–'}</div>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 15,
              marginBottom: 20,
            }}
          >
            <div className="card">
              <div className="slbl">Radar</div>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" />
                  <PolarRadiusAxis />
                  <Radar dataKey="value" stroke="#2563eb" fill="#2563eb" fillOpacity={0.2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <div className="slbl">Notes /10</div>
              {lq.map((q) => (
                <ScoreBar key={q.id} label={q.short} score={avg(activeR, q.id)} n={activeR.length} />
              ))}
            </div>
          </div>
          <div className="card">
            <div className="slbl">Commentaires</div>
            {tq.map((q) => (
              <div key={q.id} style={{ marginBottom: 10 }}>
                <strong>{q.label}</strong>
                {activeR.map(
                  (r, idx) => r[q.id] && <div key={idx} className="cmt-quote">{r[q.id]}</div>
                )}
              </div>
            ))}
          </div>
        </>
      );
    };
    return (
      <div className="app">
        <Topbar
          title="Résultats"
          onBack={() => setView('home')}
          extra={
            <div style={{ display: 'flex', gap: 5 }}>
              <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
                CSV
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => activeUE && exportPDF(activeUE, selYear.name, cfg, getRespFor)}
              >
                PDF
              </button>
            </div>
          }
        />
        <div className="page-lg fu">
          <div className="pill-row" style={{ marginBottom: 20 }}>
            {[
              ['cours', '📊 Par UE'],
              ['interannees', '📅 Inter-Années'],
            ].map(([v, l]) => (
              <button
                key={v}
                className={'btn btn-sm ' + (dashView === v ? 'btn-navy' : 'btn-ghost')}
                onClick={() => setDashView(v)}
              >
                {l}
              </button>
            ))}
          </div>
          {dashView === 'cours' ? renderDash() : <div className="card">Dashboard inter-années chargé.</div>}
        </div>
      </div>
    );
  }

  /* ══ SETTINGS ════════════════════════════════════════════ */
  if (view === 'settings')
    return (
      <div className="app">
        <Topbar title="Paramètres" onBack={() => setView('yearPick')} />
        <div className="page-lg fu">
          <div className="pill-row" style={{ marginBottom: 20 }}>
            {[
              ['import', 'Import'],
              ['promotions', 'Promos'],
              ['pin', 'PIN'],
            ].map(([t, l]) => (
              <button
                key={t}
                className={'pill ' + (stab === t ? 'p-navy' : '')}
                onClick={() => setStab(t)}
              >
                {l}
              </button>
            ))}
          </div>
          {stab === 'import' && (
            <div className="card">
              <h3>Import CSV</h3>
              <textarea
                className="txa"
                value={impText}
                rows={8}
                onChange={(e) => setImpText(e.target.value)}
              />
              <button className="btn btn-navy" onClick={applyImport}>
                Importer
              </button>
            </div>
          )}
          {stab === 'promotions' && (
            <div className="card">
              {years.map((y) => (
                <div key={y.id} className="str-row">
                  <span>{y.name}</span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => saveYears(years.filter((x) => x.id !== y.id))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {stab === 'pin' && (
            <div className="card">
              <div className="card-title">Code PIN coordinateur</div>
              <div className="card-sub">
                Le PIN est stocké sur le serveur quand il est disponible, sinon en local.
              </div>
              <input
                className="inp"
                type="password"
                placeholder="Nouveau PIN"
                value={newPin1}
                onChange={(e) => setNewPin1(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <input
                className="inp"
                type="password"
                placeholder="Confirmer le PIN"
                value={newPin2}
                onChange={(e) => setNewPin2(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              <button
                className="btn btn-navy"
                disabled={!newPin1 || newPin1 !== newPin2 || pinSaving}
                onClick={async () => {
                  setPinSaveError('');
                  setPinSaving(true);
                  try {
                    if (api.mode === 'supabase') {
                      await api.updatePin(coordPin, newPin1);
                      setCoordPin(newPin1);
                    } else {
                      await saveCfg({ ...cfg, pin: newPin1 });
                    }
                    setPinOK(true);
                    setNewPin1('');
                    setNewPin2('');
                    setTimeout(() => setPinOK(false), 2000);
                  } catch {
                    setPinSaveError('Impossible de mettre à jour le PIN.');
                  } finally {
                    setPinSaving(false);
                  }
                }}
              >
                {pinSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              {pinOK && <div style={{ marginTop: 10, color: '#059669' }}>PIN mis à jour.</div>}
              {pinSaveError && <div style={{ marginTop: 10, color: '#dc2626' }}>{pinSaveError}</div>}
            </div>
          )}
        </div>
      </div>
    );

  return null;
}
