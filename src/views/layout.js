import { escapeHtml } from '../util.js';

export const BRAND_CSS = `
.brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink);}
.brand-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--green);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.18);}
.brand-word{font-weight:750;letter-spacing:-.03em;font-size:16px;}
.brand-dot{color:var(--green);}
`;

export function bellIcon(size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`;
}

export function checkIcon(size = 26) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
}

export function brand(href = '/embed') {
  return `<a class="brand" href="${escapeHtml(href)}" aria-label="Stockly home">
    <span class="brand-mark">${bellIcon()}</span>
    <span class="brand-word">stockly<span class="brand-dot">.</span></span>
  </a>`;
}

export function document({
  title,
  description = '',
  styles = '',
  body,
  bodyClass = '',
  bodyAttributes = '',
}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
  ${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
  <style>${styles}</style>
</head>
<body class="${escapeHtml(bodyClass)}"${bodyAttributes ? ` ${bodyAttributes}` : ''}>
${body}
</body>
</html>`;
}

const MESSAGE_CSS = `
:root{--ink:#17231b;--muted:#6c7a70;--line:#e4dfd2;--paper:#fffdf8;--cream:#f4f0e6;--green:#1d6b4a;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--cream);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;}
.card{width:100%;max-width:440px;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:32px;box-shadow:0 24px 60px -40px rgba(23,35,27,.45);}
h1{font-family:"Iowan Old Style",Palatino,Georgia,serif;font-size:28px;letter-spacing:-.02em;margin:18px 0 8px;}
p{color:var(--muted);line-height:1.6;margin:0 0 24px;font-size:14px;}
a.button{display:inline-block;background:var(--green);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:10px;}
`;

export function messagePage({ title, heading, message, actionHref = '/embed', actionLabel = 'Back to the widget' }) {
  return document({
    title: `${title} · Stockly`,
    styles: `${MESSAGE_CSS}${BRAND_CSS}`,
    body: `<main class="card">
      ${brand(actionHref)}
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="button" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>
    </main>`,
  });
}
