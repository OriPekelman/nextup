/* Tiny utilities shared across NextUp pages. */

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined)
  });
  if (!res.ok) {
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

function escapeHTML(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function typeLabel(t) {
  return { text: 'Text', image: 'Image', url: 'Link', youtube: 'YouTube' }[t] || t;
}

function itemPreview(item) {
  if (item.type === 'text') {
    const s = (item.content || '').trim();
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  }
  if (item.type === 'image') return 'Image upload';
  if (item.type === 'youtube' || item.type === 'url') return item.content;
  return '';
}

function timeShort(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

/* QR code: use the Google Charts image API for simplicity, with a data-URL
   fallback. We render as <img>. For offline use you could swap this out for
   a local library. */
function qrImageUrl(text, size = 220) {
  const u = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
    '&margin=8&data=' + encodeURIComponent(text);
  return u;
}
function mountQR(el, text, size = 220) {
  const img = document.createElement('img');
  img.width = size; img.height = size;
  img.alt = 'QR code for ' + text;
  img.src = qrImageUrl(text, size);
  el.innerHTML = '';
  el.appendChild(img);
}
