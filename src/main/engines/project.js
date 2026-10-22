'use strict';
// Project schedules: Microsoft Project (.mpp, .mpt, .mpx, MS Project XML), ProjectLibre (.pod), Primavera P6 (.xer)
// and GanttProject (.gan), read with MPXJ (LGPL), which ships inside ProjectLibre, on the Java runtime Lime bundles for
// it. The task table goes to Excel or CSV, the schedule to MS Project XML or MPX, and a Gantt chart to PDF, PNG or SVG.
const U = require('./util');
const { fs, fsp, path } = U;

const IN = ['mpp', 'mpt', 'mpx', 'pod', 'xer', 'gan', 'xml'];
async function java() {
  const crafts = require('./crafts');
  const m = crafts.bundledManifest?.() || {};
  if (!m.java || !m.projectlibre) throw Object.assign(new Error('ProjectLibre isn’t in this build of Lime, so project files can’t be read.'), { code: 'ENGINE_MISSING' });
  const [jre, pl] = await Promise.all([crafts.bundledApp('java'), crafts.bundledApp('projectlibre')]);
  if (!jre || !pl) throw Object.assign(new Error('ProjectLibre isn’t in this build of Lime, so project files can’t be read.'), { code: 'ENGINE_MISSING' });
  const exe = U.isWin ? jre.replace(/javaw\.exe$/i, 'java.exe') : jre, home = path.dirname(pl);
  return { exe, cp: [pl, path.join(home, 'lib', 'projectlibre-contrib.jar')].join(path.delimiter) };
}
// MPXJ's converter picks the writer from the output's extension (.json, .xml for MS Project XML, .mpx).
async function mpxj(file, out, ctx) {
  const j = await java();
  await U.run(j.exe, ['-Djava.awt.headless=true', '-Xmx1g', '-cp', j.cp, 'net.sf.mpxj.sample.MpxjConvert', path.resolve(file), out], { signal: ctx?.signal, timeout: 300000, errorMessage: `${path.basename(file)} couldn’t be read as a project` , env: { JAVA_TOOL_OPTIONS: undefined } });
  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error(`${path.basename(file)} couldn’t be read as a project.`);
  return out;
}
const parseDate = (s) => (s ? Date.parse(String(s).replace(/\.\d+$/, '').replace(/(T\d\d:\d\d:\d\d)$/, '$1Z')) : NaN);
// The schedule as plain tasks: outline, dates, duration in days, progress, links and resources.
async function read(file, ctx) {
  const tmp = await U.tmpDir('mpxj');
  try {
    const j = JSON.parse(await fsp.readFile(await mpxj(file, path.join(tmp, 'project.json'), ctx), 'utf8'));
    const P = j.property_values || {}, perDay = (+P.minutes_per_day || 480) * 60;
    const resources = new Map((j.resources || []).map((r) => [r.unique_id, r.name || '']));
    const byTask = new Map();
    for (const a of j.assignments || []) if (resources.get(a.resource_unique_id)) (byTask.get(a.task_unique_id) || byTask.set(a.task_unique_id, []).get(a.task_unique_id)).push(resources.get(a.resource_unique_id));
    const tasks = (j.tasks || []).filter((t) => t.unique_id != null && t.name != null).map((t) => ({
      uid: t.unique_id, id: t.id, wbs: t.wbs || t.outline_number || '', name: t.name, level: +t.outline_level || 0, summary: !!t.summary, milestone: !!t.milestone, critical: !!t.critical,
      start: parseDate(t.start), finish: parseDate(t.finish), days: t.duration != null ? +(t.duration / perDay).toFixed(2) : null, done: +t.percent_complete || 0,
      preds: (t.predecessors || []).map((p) => ({ uid: p.task_unique_id, type: p.type || 'FS', lag: p.lag || 0 })), resources: byTask.get(t.unique_id) || [], notes: t.notes || '',
    })).filter((t) => t.level > 0 || !t.summary || (j.tasks || []).length === 1);
    schedule(tasks, parseDate(P.start_date));
    return { title: P.project_title || P.name || U.base(file), tasks, start: Math.min(...tasks.map((t) => t.start).filter(Number.isFinite)), finish: Math.max(...tasks.map((t) => t.finish).filter(Number.isFinite)) };
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
// Files written by MS Project carry every task's dates; others may not, so missing ones are worked out from the links
// (finish-to-start, five working days a week) and summary tasks span their children.
function schedule(tasks, projectStart) {
  const by = new Map(tasks.map((t) => [t.uid, t])), DAY = 864e5;
  const addWork = (t0, days) => { let t = t0, left = Math.max(0, days); while (left > 0) { t += DAY; const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) left -= 1; } return t; };
  const base = Number.isFinite(projectStart) ? projectStart : Math.min(...tasks.map((t) => t.start).filter(Number.isFinite).concat([Date.UTC(new Date().getUTCFullYear(), 0, 1)]));
  for (let pass = 0; pass < tasks.length; pass++) {
    let changed = false;
    for (const t of tasks) {
      if (t.summary || (Number.isFinite(t.start) && Number.isFinite(t.finish))) continue;
      const ends = t.preds.map((p) => by.get(p.uid)?.finish);
      if (ends.some((e) => !Number.isFinite(e) && e !== undefined)) continue;
      t.start = Number.isFinite(t.start) ? t.start : ends.length ? Math.max(...ends.filter(Number.isFinite), base) : base;
      t.finish = addWork(t.start, t.days || 0);
      changed = true;
    }
    if (!changed) break;
  }
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    if (!t.summary) continue;
    const kids = [];
    for (let k = i + 1; k < tasks.length && tasks[k].level > t.level; k++) kids.push(tasks[k]);
    const s = kids.map((k) => k.start).filter(Number.isFinite), f = kids.map((k) => k.finish).filter(Number.isFinite);
    if (s.length) { t.start = Number.isFinite(t.start) ? Math.min(t.start, ...s) : Math.min(...s); t.finish = Number.isFinite(t.finish) ? Math.max(t.finish, ...f) : Math.max(...f); }
  }
}
const day = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '');
const HEAD = ['ID', 'WBS', 'Task', 'Level', 'Start', 'Finish', 'Duration (days)', '% complete', 'Predecessors', 'Resources', 'Milestone', 'Summary'];
function rows(p) {
  const ids = new Map(p.tasks.map((t) => [t.uid, t.id ?? t.uid]));
  return p.tasks.map((t) => [t.id ?? '', t.wbs, `${'  '.repeat(Math.max(0, t.level - 1))}${t.name}`, t.level, day(t.start), day(t.finish), t.days ?? '', t.done, t.preds.map((x) => `${ids.get(x.uid) ?? x.uid}${x.type !== 'FS' ? x.type : ''}`).join(', '), t.resources.join(', '), t.milestone ? 'Yes' : '', t.summary ? 'Yes' : '']);
}
async function convert(file, opts, ctx) {
  const to = ['xlsx', 'csv', 'xml', 'mpx'].includes(opts.to) ? opts.to : 'xlsx';
  ctx.progress?.(0.1, 'Reading the schedule');
  if (to === 'xml' || to === 'mpx') {
    const tmp = await U.tmpDir('mpxj');
    try {
      // This MPXJ's MS Project XML writer stops on files that leave out project settings such as the currency digits;
      // going through MPX first fills them in with MS Project's defaults.
      const made = await mpxj(file, path.join(tmp, `project.${to}`), ctx).catch(async (e) => {
        if (to !== 'xml') throw e;
        return mpxj(await mpxj(file, path.join(tmp, 'step.mpx'), ctx), path.join(tmp, 'project.xml'), ctx);
      });
      const out = ctx.out.file(file, `${U.base(file)}${U.ext(file) === to ? '-converted' : ''}.${to}`);
      await fsp.copyFile(made, out);
      return { path: out, note: to === 'xml' ? 'Microsoft Project XML' : 'MPX' };
    } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
  }
  const p = await read(file, ctx);
  const table = [HEAD, ...rows(p)];
  const out = ctx.out.file(file, `${U.base(file)}-tasks.${to}`);
  if (to === 'csv') await fsp.writeFile(out, `\ufeff${table.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n')}\r\n`);
  else {
    const XLSX = require('xlsx'), wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(table);
    ws['!cols'] = [6, 8, 42, 6, 11, 11, 10, 9, 14, 24, 9, 9].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
    XLSX.writeFile(wb, out, { compression: true });
  }
  return { path: out, note: `${p.tasks.length} tasks · ${day(p.start)} to ${day(p.finish)}` };
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A Gantt chart: the task list on the left, bars on a calendar on the right, links drawn finish to start.
function ganttSvg(p) {
  const tasks = p.tasks.filter((t) => Number.isFinite(t.start) && Number.isFinite(t.finish));
  const DAY = 864e5, t0 = Math.floor((p.start - DAY) / DAY) * DAY, t1 = Math.ceil((p.finish + DAY) / DAY) * DAY, days = Math.max(1, (t1 - t0) / DAY);
  const NAME = 300, RH = 24, TOP = 64, pxDay = Math.max(4, Math.min(28, 1100 / days)), W = NAME + days * pxDay + 30, H = TOP + tasks.length * RH + 40;
  const X = (t) => NAME + ((t - t0) / DAY) * pxDay, row = new Map(tasks.map((t, i) => [t.uid, i]));
  const weeks = [];
  for (let t = t0; t <= t1; t += DAY) { const d = new Date(t); if (d.getUTCDay() === 1 || t === t0) weeks.push(t); }
  const weekend = [];
  for (let t = t0; t < t1; t += DAY) { const d = new Date(t).getUTCDay(); if (d === 0 || d === 6) weekend.push(`<rect x="${X(t).toFixed(1)}" y="${TOP}" width="${pxDay.toFixed(1)}" height="${tasks.length * RH}" fill="#f3f3f3"/>`); }
  const month = (t) => `${new Date(t).getUTCDate()} ${'JanFebMarAprMayJunJulAugSepOctNovDec'.substr(new Date(t).getUTCMonth() * 3, 3)}`;
  const bars = tasks.map((t, i) => {
    const y = TOP + i * RH, x0 = X(t.start), x1 = Math.max(X(t.finish), x0 + 2), name = `<text x="${8 + Math.max(0, t.level - 1) * 14}" y="${y + 16}" font-size="12" ${t.summary ? 'font-weight="bold"' : ''} fill="#222">${esc(t.name).slice(0, 44)}</text>`;
    if (t.milestone) return `${name}<path d="M${x0} ${y + 5}l7 7-7 7-7-7z" fill="#1d1d1f"/><text x="${x0 + 11}" y="${y + 16}" font-size="11" fill="#555">${day(t.start)}</text>`;
    if (t.summary) return `${name}<path d="M${x0} ${y + 8}H${x1}V${y + 17}l-5-4H${x0 + 5}l-5 4z" fill="#3a3a3c"/>`;
    const fill = t.critical ? '#d9480f' : '#2a6fdb';
    return `${name}<rect x="${x0.toFixed(1)}" y="${y + 6}" width="${(x1 - x0).toFixed(1)}" height="12" rx="2" fill="${fill}" opacity="0.35"/><rect x="${x0.toFixed(1)}" y="${y + 6}" width="${((x1 - x0) * t.done / 100).toFixed(1)}" height="12" rx="2" fill="${fill}"/>${t.resources.length ? `<text x="${x1 + 5}" y="${y + 16}" font-size="11" fill="#555">${esc(t.resources.join(', '))}</text>` : ''}`;
  });
  const links = tasks.flatMap((t) => t.preds.filter((pr) => row.has(pr.uid)).map((pr) => {
    const a = tasks[row.get(pr.uid)], ya = TOP + row.get(pr.uid) * RH + 12, yb = TOP + row.get(t.uid) * RH + 12, xa = X(a.finish), xb = X(t.start);
    return `<path d="M${xa} ${ya}h6V${yb}H${xb - 2}" fill="none" stroke="#666" stroke-width="1"/><path d="M${xb - 6} ${yb - 3}l4 3-4 3z" fill="#666"/>`;
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${H}" viewBox="0 0 ${Math.round(W)} ${H}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
<text x="8" y="24" font-size="16" font-weight="bold" fill="#1d1d1f">${esc(p.title)}</text><text x="8" y="44" font-size="11" fill="#555">${day(p.start)} to ${day(p.finish)} · ${tasks.length} tasks</text>
${weekend.join('')}
${weeks.map((t) => `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${TOP - 10}" y2="${TOP + tasks.length * RH}" stroke="#ddd"/><text x="${(X(t) + 3).toFixed(1)}" y="${TOP - 4}" font-size="10" fill="#555">${month(t)}</text>`).join('')}
${tasks.map((t, i) => `<line x1="0" x2="${Math.round(W)}" y1="${TOP + (i + 1) * RH}" y2="${TOP + (i + 1) * RH}" stroke="#eee"/>`).join('')}
<line x1="${NAME}" x2="${NAME}" y1="${TOP - 10}" y2="${TOP + tasks.length * RH}" stroke="#bbb"/>
${links.join('')}
${bars.join('\n')}
</svg>
`;
}
async function gantt(file, opts, ctx) {
  const to = ['png', 'svg', 'pdf'].includes(opts.to) ? opts.to : 'pdf';
  ctx.progress?.(0.1, 'Reading the schedule');
  const p = await read(file, ctx), svg = ganttSvg(p);
  ctx.progress?.(0.7, 'Drawing');
  const out = ctx.out.file(file, `${U.base(file)}-gantt.${to}`);
  if (to === 'svg') await fsp.writeFile(out, svg);
  else if (to === 'png') await require('sharp')(Buffer.from(svg), { density: 144 }).flatten({ background: '#fff' }).png().toFile(out);
  else {
    const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg);
    const tmp = await U.tmpDir('gantt');
    try {
      const html = path.join(tmp, 'gantt.html');
      await fsp.writeFile(html, `<!doctype html><meta charset="utf-8"><style>@page { size: ${w}px ${h}px; margin: 0 } html,body{margin:0} svg{display:block}</style>${svg.replace(/^<\?xml[^>]*>\s*/, '')}`);
      if (ctx.host) await ctx.host('htmlToPdf', { file: html, out, css: true });
      else {
        const { PDFDocument } = require('pdf-lib'), doc = await PDFDocument.create(), png = await doc.embedPng(await require('sharp')(Buffer.from(svg), { density: 144 }).png().toBuffer());
        doc.addPage([+w, +h]).drawImage(png, { x: 0, y: 0, width: +w, height: +h });
        await fsp.writeFile(out, await doc.save());
      }
    } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
  }
  return { path: out, note: `${p.tasks.length} tasks · ${day(p.start)} to ${day(p.finish)}` };
}
async function info(file, opts, ctx) {
  const p = await read(file, ctx), work = p.tasks.filter((t) => !t.summary);
  const text = [p.title, `${day(p.start)} to ${day(p.finish)}`, `${work.length} tasks, ${p.tasks.filter((t) => t.milestone).length} milestones, ${p.tasks.filter((t) => t.summary).length} summary tasks`,
    `${Math.round(work.reduce((s, t) => s + t.done * (t.days || 0), 0) / Math.max(1, work.reduce((s, t) => s + (t.days || 0), 0)))}% complete by duration`,
    `Resources: ${[...new Set(p.tasks.flatMap((t) => t.resources))].join(', ') || 'none'}`].join('\n');
  return { path: null, note: `${work.length} tasks · ${day(p.start)} to ${day(p.finish)}`, text };
}
module.exports = { IN, java, mpxj, read, convert, gantt, info, ganttSvg, schedule };
