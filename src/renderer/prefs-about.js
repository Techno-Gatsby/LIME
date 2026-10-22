// Settings › About: the version, when it was built, and updates from Lime's GitHub releases.
import { esc } from './ui.js';

const mb = (n) => (n ? ` (${Math.max(1, Math.round(n / 1048576))} MB)` : '');
function look(u) {
  const v = u.feed?.version;
  switch (u.phase) {
    case 'checking': return ['Checking…', '<button class="btn" disabled>Check now</button>'];
    case 'latest': return [u.note || 'Lime is up to date', '<button class="btn" data-a="update-check">Check now</button>'];
    case 'available': return u.canInstall
      ? [u.error ? `Couldn’t download: ${u.error}` : `Lime ${v} is out${mb(u.feed.size)}`, '<button class="btn primary" data-a="update-get">Download</button>']
      : [`Lime ${v} is out. It downloads from the release page`, '<button class="btn primary" data-a="update-get">Download update</button>'];
    case 'downloading': return [`Downloading Lime ${v}… ${u.pct || 0}%`, '<button class="btn" disabled>Download</button>'];
    case 'ready': return [`Lime ${v} is ready to install`, '<button class="btn primary" data-a="update-install">Restart to update</button>'];
    case 'error': return [`Couldn’t check: ${u.error}`, '<button class="btn" data-a="update-check">Try again</button>'];
    default: return ['Looks for a newer Lime on GitHub', '<button class="btn" data-a="update-check">Check now</button>'];
  }
}
const built = (iso) => { const d = iso && new Date(iso); return d && !isNaN(d) ? `Built ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Not a release build'; };

export function aboutRows(row, sw, info, s, u) {
  const [sub, ctl] = look(u);
  return `${row('info', `Lime ${esc(info.version)}`, built(info.built), '')}
    ${row('extract', 'Updates', esc(sub), ctl).replace('<div class="row">', '<div class="row" id="update-row">')}
    ${row('again', 'Check once a day', 'When Lime starts. Only Lime’s release page is contacted', sw('updateCheck', s.updateCheck !== false))}`;
}

export function wireAbout(app, api, keep) {
  const paint = (u) => {
    const r = app.querySelector('#update-row');
    if (!r) return;
    const [sub, ctl] = look(u);
    r.querySelector('small').textContent = sub;
    r.querySelector('.btn').outerHTML = ctl;
  };
  api.on('update:state', (u) => { keep(u); paint(u); });
  app.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'update-check') api.invoke('update:check');
    if (a === 'update-get') api.invoke('update:get');
    if (a === 'update-install') api.invoke('update:install');
  });
}
