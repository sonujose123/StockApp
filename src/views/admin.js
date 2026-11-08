import { escapeHtml, formatDateTime } from '../util.js';
import { BRAND_CSS, brand, document } from './layout.js';

const AUTH_CSS = `
:root{--ink:#17231b;--muted:#6c7a70;--line:#e5dfd1;--paper:#fffdf8;--cream:#f4f0e6;--green:#1d6b4a;--green-dark:#145138;--red:#a63a2c;color-scheme:light}
*{box-sizing:border-box}
body.auth{
  margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;color:var(--ink);
  font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:
    radial-gradient(1100px 560px at 12% -12%, #e7f0e6 0%, rgba(231,240,230,0) 60%),
    radial-gradient(900px 480px at 112% 8%, #efe5d0 0%, rgba(239,229,208,0) 55%),
    var(--cream);
  -webkit-font-smoothing:antialiased;
}
.auth-wrap{width:100%;max-width:432px}
.auth-card{
  position:relative;overflow:hidden;background:var(--paper);border:1px solid var(--line);border-radius:20px;
  padding:34px 32px 28px;box-shadow:0 30px 70px -44px rgba(23,35,27,.5);
}
.auth-card::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--green),#9cbfa9)}
${BRAND_CSS}
.auth-card .brand{margin-bottom:26px}
.eyebrow{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:750;color:var(--muted);margin:0}
h1{font-family:"Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;font-size:32px;line-height:1.1;letter-spacing:-.03em;margin:7px 0 8px}
.sub{font-size:13.5px;line-height:1.6;color:var(--muted);margin:0 0 22px}
label{display:block;font-size:11.5px;font-weight:650;margin:0 0 7px;color:#3f4f45}
input[type=password]{
  width:100%;height:47px;border:1px solid #d8d1c2;border-radius:12px;padding:0 14px;font:inherit;font-size:14px;
  background:#fff;color:var(--ink);outline:none;transition:border-color .15s ease,box-shadow .15s ease;
}
input[type=password]:focus{border-color:var(--green);box-shadow:0 0 0 4px rgba(29,107,74,.12)}
button[type=submit]{
  width:100%;height:47px;margin-top:14px;border:0;border-radius:12px;background:var(--green);color:#fff;
  font:inherit;font-size:14px;font-weight:650;cursor:pointer;
}
button[type=submit]:hover{background:var(--green-dark)}
.error{margin:0 0 16px;padding:10px 12px;border:1px solid #f1d2ca;background:#fbebe7;border-radius:10px;color:var(--red);font-size:12.5px;line-height:1.45}
.foot{margin:20px 0 0;text-align:center;font-size:12px}
.foot a{color:var(--muted);text-decoration:none}
.foot a:hover{color:var(--green)}
`;

const ADMIN_CSS = `
:root{--ink:#17231b;--muted:#6c7a70;--line:#e5dfd1;--paper:#fffdf8;--cream:#f4f0e6;--green:#1d6b4a;--green-dark:#145138;--amber:#8a5a12;--red:#9d3529;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--green)}
small{font-size:12px}
.topbar{position:sticky;top:0;z-index:5;background:rgba(255,253,248,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}
.topbar-inner{max-width:1160px;margin:0 auto;padding:13px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.topbar .brand{margin:0}
.topbar-side{display:flex;align-items:center;gap:16px}
.admin-chip{font-size:10px;font-weight:750;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:4px 9px}
.link-button{border:0;background:none;font:inherit;font-size:13px;color:var(--muted);cursor:pointer;padding:0}
.link-button:hover{color:var(--ink)}
main{max-width:1160px;margin:0 auto;padding:36px 24px 56px}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:26px}
.eyebrow{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:750;color:var(--muted);margin:0}
h1{font-family:"Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;font-size:34px;line-height:1.1;letter-spacing:-.035em;margin:7px 0 7px}
.sub{font-size:13.5px;line-height:1.55;color:var(--muted);margin:0;max-width:560px}
.ghost-button{
  display:inline-flex;align-items:center;gap:7px;white-space:nowrap;text-decoration:none;color:var(--ink);
  font-size:12.5px;font-weight:650;border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:var(--paper);
}
.ghost-button:hover{border-color:#cfc6b4;background:#fff}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:24px}
.stat{position:relative;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:15px 17px 14px;overflow:hidden}
.stat::after{content:"";position:absolute;left:17px;top:0;width:26px;height:2px;background:var(--green);opacity:.55}
.stat-label{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:750}
.stat-value{display:block;font-size:29px;font-weight:750;letter-spacing:-.04em;line-height:1.15;margin-top:7px}
.stat-note{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 50px -46px rgba(23,35,27,.55);overflow:hidden;margin-bottom:22px}
.card-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:17px 20px;border-bottom:1px solid var(--line)}
h2{font-size:14.5px;letter-spacing:-.01em;margin:0}
.filters{display:flex;align-items:center;gap:8px}
input[type=search]{
  height:36px;width:230px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);
  padding:0 11px;font:inherit;font-size:12.5px;outline:none;
}
input[type=search]:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(29,107,74,.1)}
.small-button{height:36px;border:1px solid var(--line);background:var(--paper);border-radius:9px;padding:0 13px;font:inherit;font-size:12.5px;font-weight:650;color:var(--ink);cursor:pointer}
.small-button:hover{background:var(--cream)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px;border-bottom:1px solid var(--line)}
.tab{display:inline-flex;align-items:center;gap:7px;text-decoration:none;color:var(--muted);font-size:12.5px;font-weight:600;padding:6px 10px;border-radius:8px}
.tab:hover{background:var(--cream);color:var(--ink)}
.tab.active{background:#e9f2ec;color:var(--green)}
.tab .count{font-size:11px;font-weight:750;color:inherit;opacity:.65}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:760px}
th{text-align:left;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);font-weight:750;padding:11px 20px;border-bottom:1px solid var(--line);background:#fbf8f1}
td{padding:14px 20px;border-bottom:1px solid #eee8dc;vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:#fdfbf5}
.email{font-weight:550;word-break:break-word;max-width:260px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}
.muted{color:var(--muted)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;white-space:nowrap}
.pill::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.pill.pending{background:#fdf3df;color:#8a5a12}
.pill.notified{background:#e8f3ec;color:#1d6b4a}
.pill.failed{background:#fbeae7;color:#9d3529}
.pill.neutral{background:#f0ede4;color:#6c7a70}
time{white-space:nowrap}
.empty{padding:52px 24px;text-align:center}
.empty-mark{width:44px;height:44px;margin:0 auto 12px;border-radius:50%;background:#eef4ee;color:var(--green);display:grid;place-items:center}
.empty h3{font-family:"Iowan Old Style",Palatino,Georgia,serif;font-size:20px;font-weight:500;letter-spacing:-.02em;margin:0 0 5px}
.empty p{font-size:13px;color:var(--muted);margin:0}
.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 20px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
.pagination-links{display:flex;gap:8px}
.pagination a{text-decoration:none;font-weight:650;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
.pagination a:hover{background:var(--cream)}
.pagination .disabled{opacity:.35;pointer-events:none}
.events-table{min-width:640px}
.events-table td{padding:12px 20px}
.footnote{text-align:center;font-size:11.5px;color:#909a91;margin:26px 0 0}
@media (max-width:860px){
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .page-head{flex-direction:column;align-items:flex-start;gap:14px}
  h1{font-size:30px}
  .filters{width:100%}
  input[type=search]{flex:1;width:auto;min-width:0}
  .topbar-inner{padding:12px 16px}
  main{padding:26px 16px 44px}
  .card-head{align-items:flex-start}
}
.notice{margin:0 0 18px;padding:11px 14px;border:1px solid #d5e8da;background:#eef6f0;border-radius:10px;color:var(--green-dark);font-size:12.5px;line-height:1.55}
.retry-form{display:inline}
.retry{margin-left:8px;border:1px solid var(--line);background:var(--paper);border-radius:7px;padding:2px 8px;font:inherit;font-size:11px;font-weight:650;color:var(--ink);cursor:pointer;vertical-align:middle}
.retry:hover{background:var(--cream)}
`;

const REQUEST_STATUS = {
  pending: ['Waiting', 'pending'],
  notified: ['Notified', 'notified'],
  failed: ['Failed', 'failed'],
};

const EVENT_STATUS = {
  received: ['Queued', 'pending'],
  processing: ['Checking', 'pending'],
  processed: ['Processed', 'notified'],
  ignored: ['No stock', 'neutral'],
  failed: ['Failed', 'failed'],
};

function adminHref({ status = 'all', q = '', page = 1 } = {}) {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin${query ? `?${query}` : ''}`;
}

function pill(label, variant) {
  return `<span class="pill ${variant}">${escapeHtml(label)}</span>`;
}

export function renderLogin({ error = '' } = {}) {
  return document({
    title: 'Admin · Stockly',
    styles: `${AUTH_CSS}`,
    bodyClass: 'auth',
    body: `<main class="auth-wrap">
      <div class="auth-card">
        ${brand('/admin/login')}
        <p class="eyebrow">Operations</p>
        <h1>Sign in</h1>
        <p class="sub">See every back-in-stock request, its status, and the exact moment the customer was emailed.</p>
        ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/admin/login">
          <label for="password">Admin password</label>
          <input id="password" type="password" name="password" autocomplete="current-password" required autofocus>
          <button type="submit">Sign in</button>
        </form>
        <p class="foot"><a href="/embed">← Back to the widget</a></p>
      </div>
    </main>`,
  });
}

export function renderAdmin({ rows, total, page, pageCount, stats, events, filters, notice = '' }) {
  const status = filters.status;
  const tabs = [
    { key: 'all', label: 'All', count: stats.total },
    { key: 'pending', label: 'Waiting', count: stats.pending },
    { key: 'notified', label: 'Notified', count: stats.notified },
    { key: 'failed', label: 'Failed', count: stats.failed },
  ]
    .map((tab) => `<a class="tab${status === tab.key ? ' active' : ''}" href="${adminHref({ status: tab.key, q: filters.q })}">${tab.label} <span class="count">${tab.count}</span></a>`)
    .join('');

  const rowsHtml = rows.length
    ? rows.map((request) => {
      const [label, variant] = REQUEST_STATUS[request.status] || ['Unknown', 'neutral'];
      const errorTitle = request.last_error ? ` title="${escapeHtml(request.last_error)}"` : '';
      return `<tr>
        <td><!--email_off--><div class="email">${escapeHtml(request.email)}</div><!--/email_off--></td>
        <td><span class="mono">${escapeHtml(request.sku)}</span></td>
        <td><time datetime="${escapeHtml(request.created_at)}" title="${escapeHtml(request.created_at)}">${formatDateTime(request.created_at)}</time></td>
        <td><span${errorTitle}>${pill(label, variant)}</span>${request.status === 'failed'
          ? `<form class="retry-form" method="post" action="/admin/requests/${encodeURIComponent(request.id)}/retry"><button class="retry" type="submit">Retry</button></form>`
          : ''}</td>
        <td>${request.notified_at
          ? `<time datetime="${escapeHtml(request.notified_at)}" title="${escapeHtml(request.notified_at)}">${formatDateTime(request.notified_at)}</time>`
          : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="5">
        <div class="empty">
          <div class="empty-mark">${'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'}</div>
          <h3>No requests yet</h3>
          <p>Requests from the embed form will land here in real time.</p>
        </div>
      </td></tr>`;

  const eventsHtml = events.length
    ? events.map((event) => {
      const [label, variant] = EVENT_STATUS[event.status] || ['Unknown', 'neutral'];
      const note = event.last_error ? ` title="${escapeHtml(event.last_error)}"` : '';
      return `<tr>
        <td><span class="mono" title="${escapeHtml(event.event_id)}">${escapeHtml(event.event_id.slice(0, 12))}${event.event_id.length > 12 ? '…' : ''}</span></td>
        <td><span class="mono">${escapeHtml(event.sku)}</span></td>
        <td>${event.quantity === null || event.quantity === undefined ? '<span class="muted">—</span>' : escapeHtml(String(event.quantity))}</td>
        <td><span${note}>${pill(label, variant)}</span></td>
        <td><time datetime="${escapeHtml(event.received_at)}" title="${escapeHtml(event.received_at)}">${formatDateTime(event.received_at)}</time></td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="5"><div class="empty"><p>No stock webhooks received yet.</p></div></td></tr>`;

  const from = total === 0 ? 0 : (page - 1) * 25 + 1;
  const to = Math.min(page * 25, total);
  const pagination = pageCount > 1
    ? `<div class="pagination">
        <span>Showing ${from}–${to} of ${total}</span>
        <div class="pagination-links">
          <a class="${page <= 1 ? 'disabled' : ''}" href="${adminHref({ status, q: filters.q, page: page - 1 })}">Previous</a>
          <a class="${page >= pageCount ? 'disabled' : ''}" href="${adminHref({ status, q: filters.q, page: page + 1 })}">Next</a>
        </div>
      </div>`
    : '';

  return document({
    title: 'Requests · Stockly Admin',
    styles: `${ADMIN_CSS}${BRAND_CSS}`,
    body: `<header class="topbar">
      <div class="topbar-inner">
        ${brand('/admin')}
        <div class="topbar-side">
          <span class="admin-chip">Admin</span>
          <form method="post" action="/admin/logout"><button class="link-button" type="submit">Sign out</button></form>
        </div>
      </div>
    </header>
    <main>
      <div class="page-head">
        <div>
          <p class="eyebrow">Operations</p>
          <h1>Back-in-stock requests</h1>
          <p class="sub">Every customer waiting on a restock, plus the moment their one email went out.</p>
        </div>
        <a class="ghost-button" href="/embed" target="_blank" rel="noopener">View widget <span aria-hidden="true">↗</span></a>
      </div>

      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ''}

      <section class="stats" aria-label="Request summary">
        <div class="stat"><span class="stat-label">Waiting</span><span class="stat-value">${stats.pending}</span><span class="stat-note">to be emailed</span></div>
        <div class="stat"><span class="stat-label">Notified</span><span class="stat-value">${stats.notified}</span><span class="stat-note">all time</span></div>
        <div class="stat"><span class="stat-label">Last 24 hours</span><span class="stat-value">${stats.notifiedRecently}</span><span class="stat-note">emails sent</span></div>
        <div class="stat"><span class="stat-label">Failed</span><span class="stat-value">${stats.failed}</span><span class="stat-note">need a look</span></div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Requests</h2>
          <form class="filters" method="get" action="/admin">
            ${status !== 'all' ? `<input type="hidden" name="status" value="${escapeHtml(status)}">` : ''}
            <input type="search" name="q" value="${escapeHtml(filters.q)}" placeholder="Search email or SKU" aria-label="Search requests">
            <button class="small-button" type="submit">Search</button>
          </form>
        </div>
        <nav class="tabs" aria-label="Filter requests">${tabs}</nav>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>SKU</th><th>Requested</th><th>Status</th><th>Notified</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        ${pagination}
      </section>

      <section class="card">
        <div class="card-head"><h2>Stock webhooks</h2><span class="muted small">Latest 8</span></div>
        <div class="table-wrap">
          <table class="events-table">
            <thead><tr><th>Event</th><th>SKU</th><th>Qty</th><th>Result</th><th>Received</th></tr></thead>
            <tbody>${eventsHtml}</tbody>
          </table>
        </div>
      </section>

      <p class="footnote">Stockly · verified restocks, one email per customer.</p>
    </main>`,
  });
}
