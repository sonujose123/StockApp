import { escapeHtml, formatMoney, safeHttpUrl } from '../util.js';
import { BRAND_CSS, bellIcon, brand, checkIcon, document } from './layout.js';

const EMBED_CSS = `
:root{
  --ink:#17231b;--muted:#6c7a70;--line:#e4dfd2;--paper:#fffdf8;--cream:#f5f1e6;
  --green:#1d6b4a;--green-dark:#145138;--red:#a63a2c;--amber:#a06a1b;
  color-scheme:light;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent}
body{
  font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
[hidden]{display:none!important}
.wrap{width:100%;max-width:520px;margin:0 auto;padding:14px}
.card{
  position:relative;background:var(--paper);border:1px solid var(--line);border-radius:20px;
  padding:28px 26px 24px;box-shadow:0 18px 44px -28px rgba(23,35,27,.4);overflow:hidden;
}
.card::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--green),#9cbfa9)}
${BRAND_CSS}
.brand{margin-bottom:22px}
.kicker{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:750;color:var(--muted);margin:0}
h1{font-family:"Iowan Old Style",Palatino,"Palatino Linotype",Georgia,serif;font-size:31px;line-height:1.12;letter-spacing:-.025em;margin:7px 0 9px}
.lede{color:var(--muted);font-size:13.5px;line-height:1.55;margin:0 0 19px}
.product{
  display:flex;align-items:center;gap:13px;padding:11px;margin:0 0 20px;
  background:linear-gradient(180deg,#fbf8f0,#f6f1e5);border:1px solid #ebe4d6;border-radius:14px;
}
.product-thumb{
  flex:0 0 54px;width:54px;height:54px;border-radius:10px;overflow:hidden;background:#ebe5d8;
  display:grid;place-items:center;color:var(--green);font-family:Georgia,serif;font-size:22px;
}
.product-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.product-copy{min-width:0}
.product-name{font-size:13.5px;font-weight:650;line-height:1.35;margin:0}
.product-meta{display:flex;align-items:center;gap:7px;margin:3px 0 0;font-size:11.5px;color:var(--muted)}
.dot{width:6px;height:6px;border-radius:50%;background:var(--amber);display:inline-block;flex:0 0 6px}
.dot.in{background:var(--green)}
.field{margin-top:13px}
label{display:block;font-size:11.5px;font-weight:650;letter-spacing:.01em;margin:0 0 6px;color:#3f4f45}
input[type=email],input[type=text]{
  width:100%;height:47px;border:1px solid #d8d1c2;border-radius:12px;padding:0 14px;
  font:inherit;font-size:14px;background:#fff;color:var(--ink);outline:none;
  transition:border-color .15s ease,box-shadow .15s ease;
}
input::placeholder{color:#a2aaa3}
input[type=email]:focus,input[type=text]:focus{border-color:var(--green);box-shadow:0 0 0 4px rgba(29,107,74,.12)}
button.primary{
  width:100%;height:48px;margin-top:15px;border:0;border-radius:12px;background:var(--green);
  color:#fff;font:inherit;font-size:14px;font-weight:650;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  transition:background .15s ease,transform .1s ease;
}
button.primary:hover{background:var(--green-dark)}
button.primary:active{transform:translateY(1px)}
button.primary:disabled{opacity:.7;cursor:wait;transform:none}
.arrow{font-size:15px;line-height:1;transform:translateY(-.5px)}
.fineprint{font-size:11px;line-height:1.5;color:var(--muted);text-align:center;margin:11px 0 0}
.error{
  margin:13px 0 0;padding:10px 12px;border-radius:10px;background:#fbebe7;border:1px solid #f1d2ca;
  color:var(--red);font-size:12.5px;line-height:1.45;
}
.success{text-align:center;padding:8px 2px 2px}
.check{
  width:56px;height:56px;border-radius:50%;background:#e7f2ea;color:var(--green);
  display:grid;place-items:center;margin:0 auto 15px;border:1px solid #d5e8da;
}
.success h1{font-size:28px;margin:0 0 8px}
.success .lede{margin:0 auto 20px;max-width:330px}
button.secondary{
  border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit;font-size:12.5px;
  font-weight:600;padding:9px 14px;border-radius:9px;cursor:pointer;
}
button.secondary:hover{background:var(--cream)}
.noscript{font-size:12px;color:var(--red);margin-top:12px}
@media (max-width:430px){
  .wrap{padding:10px}
  .card{padding:23px 18px 20px;border-radius:16px}
  h1{font-size:27px}
  .lede{font-size:13px}
}
`;

function embedScript(nonce) {
  return `<script nonce="${nonce}">
(() => {
  "use strict";
  const form = document.getElementById("bis-form");
  const email = document.getElementById("email");
  const skuInput = document.getElementById("sku");
  const hiddenSku = form.querySelector('input[type="hidden"][name="sku"]');
  const button = document.getElementById("submit");
  const buttonLabel = document.getElementById("submit-label");
  const errorBox = document.getElementById("error");
  const success = document.getElementById("success");
  const successCopy = document.getElementById("success-copy");
  const again = document.getElementById("again");
  const intro = document.getElementById("intro");
  const productName = document.body.dataset.product || "this item";
  let originalLabel = buttonLabel.textContent;

  function announceHeight() {
    requestAnimationFrame(() => {
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      try {
        window.parent.postMessage({ type: "stockly:embed:height", height: height }, "*");
      } catch (error) { /* standalone page */ }
    });
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    announceHeight();
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function setBusy(busy) {
    button.disabled = busy;
    form.setAttribute("aria-busy", busy ? "true" : "false");
    buttonLabel.textContent = busy ? "Adding you…" : originalLabel;
  }

  async function submit() {
    clearError();
    const emailValue = email.value.trim();
    const sku = hiddenSku ? hiddenSku.value : (skuInput ? skuInput.value.trim() : "");

    if (!emailValue) {
      showError("Enter your email address.");
      email.focus();
      return;
    }
    if (!sku) {
      showError("Enter the product code.");
      if (skuInput) skuInput.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailValue, sku: sku })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError(data.message || "Something went wrong. Please try again.");
        return;
      }
      successCopy.textContent = data.duplicate
        ? "You're already on the list. We'll email " + emailValue + " when " + productName + " is back."
        : "We'll email " + emailValue + " the moment " + productName + " is back in stock.";
      intro.hidden = true;
      form.hidden = true;
      success.hidden = false;
      announceHeight();
    } catch (error) {
      showError("We couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  again.addEventListener("click", () => {
    success.hidden = true;
    form.hidden = false;
    intro.hidden = false;
    clearError();
    email.focus();
    email.select();
    announceHeight();
  });

  window.addEventListener("load", announceHeight);
  if ("ResizeObserver" in window) {
    new ResizeObserver(announceHeight).observe(document.body);
  }
})();
</script>`;
}

export function renderEmbed({ sku, product, nonce }) {
  const productName = product?.name || (sku ? `Product ${sku}` : 'this item');
  const price = formatMoney(product?.price ?? null, product?.currency ?? null);
  // The embed's CSP only allows https images, so an http thumbnail would be
  // silently blocked. Fall back to the initial instead of a dead <img>.
  const httpImage = safeHttpUrl(product?.imageUrl);
  const image = httpImage?.startsWith('https://') ? httpImage : null;
  const inStock = product?.inStock === true;
  const meta = [inStock ? 'In stock now' : 'Sold out', price].filter(Boolean).join(' · ');
  const initial = escapeHtml((productName.trim()[0] || 'S').toUpperCase());

  const thumb = image
    ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
    : `<span aria-hidden="true">${initial}</span>`;

  const productBlock = sku
    ? `<div class="product">
        <div class="product-thumb">${thumb}</div>
        <div class="product-copy">
          <p class="product-name">${escapeHtml(productName)}</p>
          <p class="product-meta"><span class="dot${inStock ? ' in' : ''}"></span>${escapeHtml(meta || 'Restock alert')}</p>
        </div>
      </div>`
    : '';

  const skuField = sku
    ? `<input type="hidden" name="sku" value="${escapeHtml(sku)}">`
    : `<div class="field">
        <label for="sku">Product code</label>
        <input id="sku" name="sku" type="text" placeholder="e.g. LINEN-SHIRT-M" autocomplete="off" required>
      </div>`;

  const body = `<div class="wrap">
  <div class="card">
    ${brand('/embed')}
    <div id="intro">
      <p class="kicker">Back-in-stock alert</p>
      <h1>${sku ? 'Get it back.' : 'Never miss a restock.'}</h1>
      <p class="lede">${sku
        ? `We'll email you once, the moment this item is available again. No marketing, no noise.`
        : `Leave your email and the product code. We'll tell you the moment it's back.`}</p>
    </div>
    ${productBlock}
    <form id="bis-form" novalidate>
      ${skuField}
      <div class="field">
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email" required>
      </div>
      <p class="error" id="error" role="alert" hidden></p>
      <button class="primary" id="submit" type="submit">
        <span id="submit-label">Notify me</span>
        <span class="arrow" aria-hidden="true">→</span>
      </button>
      <p class="fineprint">One email when it's back. That's it.</p>
      <noscript><p class="noscript">Please enable JavaScript to request an alert.</p></noscript>
    </form>
    <div class="success" id="success" hidden aria-live="polite">
      <div class="check">${checkIcon()}</div>
      <h1>You're on the list.</h1>
      <p class="lede" id="success-copy">We'll email you the moment it's back in stock.</p>
      <button class="secondary" id="again" type="button">Use a different email</button>
    </div>
  </div>
</div>
${embedScript(nonce)}`;

  return document({
    title: `${productName} · Stockly`,
    description: 'Get one email the moment this item is back in stock.',
    styles: EMBED_CSS,
    body,
    bodyAttributes: `data-product="${escapeHtml(productName)}"`,
  });
}
