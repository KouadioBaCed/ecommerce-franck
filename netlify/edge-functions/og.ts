// Netlify Edge Function — injects per-product Open Graph / Twitter meta tags
// into the SPA's index.html so link previews (WhatsApp, Facebook, X, iMessage…)
// show the real product name, description and PHOTO.
//
// Why this is needed: social crawlers do not run JavaScript, so they only see
// the static HTML. This function fetches the product from Supabase at request
// time and rewrites the <head> before the HTML reaches the crawler.
//
// Runs on `/product/*` (see `config.path` below). Requires the site env vars
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (already set for the build).

import type { Context } from 'https://edge.netlify.com';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function handler(req: Request, context: Context): Promise<Response> {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/product\/([^/]+)\/?$/);

  // Let the normal SPA response through; only enrich real product URLs.
  const response = await context.next();
  if (!match) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const id = decodeURIComponent(match[1]);
  const SUPABASE_URL =
    Deno.env.get('VITE_SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
  const ANON =
    Deno.env.get('VITE_SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  if (!SUPABASE_URL || !ANON) return response;

  // Fetch the product (anon key + public read RLS).
  let product: { name?: string; description?: string; image_url?: string } | null = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=name,description,image_url&limit=1`,
      { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } },
    );
    if (r.ok) {
      const rows = await r.json();
      product = Array.isArray(rows) ? rows[0] ?? null : null;
    }
  } catch {
    return response; // network issue → fall back to default meta
  }
  if (!product) return response;

  const title = `${esc(product.name) || 'Produit'} — Marketoos`;
  const desc = esc((product.description || 'Découvrez ce produit sur Marketoos.').slice(0, 200));
  const image = product.image_url ? esc(product.image_url) : '';
  const pageUrl = esc(url.href);

  let html = await response.text();

  // Drop the default title / description / og / twitter tags, then inject ours.
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/gi, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, '');

  const tags =
    `\n    <meta name="description" content="${desc}" />` +
    `\n    <meta property="og:type" content="product" />` +
    `\n    <meta property="og:title" content="${title}" />` +
    `\n    <meta property="og:description" content="${desc}" />` +
    `\n    <meta property="og:url" content="${pageUrl}" />` +
    (image ? `\n    <meta property="og:image" content="${image}" />` : '') +
    `\n    <meta name="twitter:card" content="summary_large_image" />` +
    `\n    <meta name="twitter:title" content="${title}" />` +
    `\n    <meta name="twitter:description" content="${desc}" />` +
    (image ? `\n    <meta name="twitter:image" content="${image}" />` : '') +
    '\n  ';

  html = html.replace('</head>', `${tags}</head>`);

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');
  return new Response(html, { status: 200, headers });
}

export const config = { path: '/product/*' };
