import { escapeHtml, formatMoney, safeHttpUrl, truncate } from '../util.js';

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export function renderEmail({ request, product, config }) {
  const rawName = String(product?.name || `your item (${request.sku})`).replace(/\s+/g, ' ').trim();
  const name = escapeHtml(truncate(rawName, 90));
  const price = formatMoney(product?.price ?? null, product?.currency ?? null);
  const image = safeHttpUrl(product?.imageUrl);
  const link = safeHttpUrl(product?.url) || safeHttpUrl(config?.shopUrl);
  const initial = escapeHtml((rawName[0] || 'S').toUpperCase());
  const email = escapeHtml(request.email);
  const subject = truncate(`${rawName} is back in stock`, 120);
  const preheader = escapeHtml(`The ${rawName} you asked about is available again.`);

  const imageCell = image
    ? `<img src="${escapeHtml(image)}" width="88" height="88" alt="${name}" style="display:block;width:88px;height:88px;border-radius:12px;object-fit:cover;border:1px solid #e3dccd;">`
    : `<div style="width:88px;height:88px;background:#ebe5d8;border-radius:12px;text-align:center;line-height:88px;font-family:${SERIF};font-size:32px;color:#1d6b4a;">${initial}</div>`;

  const priceLine = price
    ? `<div style="font-size:13px;line-height:1.4;color:#6c7a70;margin-top:4px;">${escapeHtml(price)}</div>`
    : '';

  const cta = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
        <tr>
          <td align="center" bgcolor="#1d6b4a" style="border-radius:12px;mso-padding-alt:14px 28px;">
            <a class="email-cta" href="${escapeHtml(link)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:12px;">Shop the restock&nbsp;&nbsp;→</a>
          </td>
        </tr>
      </table>`
    : `<p style="margin:26px 0 0;font-size:14px;line-height:1.6;color:#45544a;">Head back to the store to grab it before it sells out again.</p>`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width:600px){
      .email-container{width:100%!important}
      .email-card{padding:28px 22px!important;border-radius:16px!important}
      .email-h1{font-size:31px!important}
      .email-product-cell{padding:12px!important}
      .email-image{width:72px!important;height:72px!important}
      .email-cta{display:block!important;width:auto!important}
      .email-inner{padding:18px 12px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f2eee2;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2eee2" style="background-color:#f2eee2;">
    <tr>
      <td align="center" class="email-inner" style="padding:34px 12px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-container" style="width:100%;max-width:560px;">
          <tr>
            <td style="padding:0 6px 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="30" height="30" align="center" bgcolor="#1d6b4a" style="width:30px;height:30px;border-radius:9px;font-family:${SERIF};font-size:17px;font-weight:700;color:#ffffff;">S</td>
                  <td style="padding-left:9px;font-family:${FONT};font-size:16px;font-weight:800;letter-spacing:-0.4px;color:#17231b;">stockly<span style="color:#1d6b4a;">.</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-card" style="background-color:#fffdf8;border:1px solid #e7e0d2;border-radius:20px;padding:40px 38px 34px;">
              <p style="margin:0 0 10px;font-family:${FONT};font-size:10.5px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#1d6b4a;">Back in stock</p>
              <h1 class="email-h1" style="margin:0 0 12px;font-family:${SERIF};font-size:38px;line-height:1.08;letter-spacing:-1.2px;color:#17231b;">It's back.</h1>
              <p style="margin:0 0 22px;font-family:${FONT};font-size:15px;line-height:1.65;color:#526056;">
                Good news — <strong style="color:#17231b;">${name}</strong> is in stock again. We thought you'd want to know first.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f3e8" style="background-color:#f7f3e8;border:1px solid #ebe4d6;border-radius:14px;">
                <tr>
                  <td width="88" valign="middle" class="email-product-cell" style="padding:16px 0 16px 16px;">${imageCell}</td>
                  <td valign="middle" class="email-product-cell" style="padding:16px;">
                    <div style="font-family:${FONT};font-size:15px;font-weight:700;line-height:1.35;color:#17231b;">${name}</div>
                    ${priceLine}
                  </td>
                </tr>
              </table>

              ${cta}

              <p style="margin:24px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.6;color:#7b877d;">
                Stock moves fast. If it's gone by the time you get there, you can ask us to watch it again.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;">
                <tr><td height="1" bgcolor="#ece6d9" style="height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>
              </table>

              <p style="margin:18px 0 0;font-family:${FONT};font-size:11.5px;line-height:1.65;color:#8b968d;">
                You're receiving this one-time email because ${email} asked to be notified about this item. No newsletters, no offers — just this.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0;font-family:${FONT};font-size:11px;line-height:1.6;color:#909a91;text-align:center;">
              Stockly · back-in-stock alerts for independent stores<br>
              If you changed your mind, you can safely ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    "It's back.",
    '',
    `Good news — ${rawName} is in stock again.`,
    ...(price ? [`Price: ${price}`] : []),
    '',
    link ? `Shop the restock: ${link}` : 'Head back to the store to grab it.',
    '',
    `You're receiving this one-time email because ${request.email} asked to be notified about this item.`,
    '',
    'Stockly · back-in-stock alerts',
  ].join('\n');

  return { subject, html, text };
}
