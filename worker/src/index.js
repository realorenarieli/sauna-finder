// ── Sauna Finder Extraction Worker ──────────────
// Secure proxy: fetches a URL, sends page text to Claude for structured extraction.
// Rate-limited per-IP (5/hr) and globally (50/day).

const ALLOWED_ORIGINS = [
  'https://realorenarieli.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const PER_IP_LIMIT = 5;
const PER_IP_WINDOW_SEC = 3600;
const GLOBAL_DAILY_LIMIT = 50;

const SAUNA_TYPES = [
  'wood-fired', 'smoke', 'electric', 'russian-banya',
  'korean-jjimjilbang', 'japanese-sento', 'boat', 'tent',
  'infrared', 'steam', 'traditional-finnish', 'other',
];

const SYSTEM_PROMPT = `You are a sauna data extractor. Given text content from a sauna's webpage, extract structured information. Return ONLY valid JSON — no markdown fences, no explanation.

If a field cannot be determined, use null. For "type", choose the closest match from: ${SAUNA_TYPES.join(', ')}.

For scores, use your best judgment based on descriptions and characteristics (0-10 scale). These scores represent a "Finnish public sauna affinity" rating:
- heatSource: 10 = wood-fired/smoke, 4-5 = electric
- loylyQuality: steam quality and intensity
- communalAtmosphere: shared/communal bathing experience
- waterAccess: lake, sea, plunge pool, cold water access
- noFrills: authentic/simple vs luxury/spa-like (higher = more authentic)
- tradition: cultural/historical roots
- overall: general quality and feel

If there is not enough info to score a dimension, default to 5.`;

const USER_PROMPT_TEMPLATE = (url, text) => `Extract sauna data from this webpage:

URL: ${url}

Page content:
${text}

Return JSON with exactly these fields:
{
  "name": "string or null",
  "city": "string or null",
  "country": "string or null",
  "address": "string or null",
  "type": "one of: ${SAUNA_TYPES.join('|')}",
  "hours": "string or null",
  "price": "string or null",
  "website": "${url}",
  "highlights": "2-3 sentence summary of what makes this sauna special, or null",
  "nude": true or false or null,
  "scores": {
    "heatSource": 0-10,
    "loylyQuality": 0-10,
    "communalAtmosphere": 0-10,
    "waterAccess": 0-10,
    "noFrills": 0-10,
    "tradition": 0-10,
    "overall": 0-10
  }
}`;

// ── CORS ────────────────────────────────────
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function checkOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  return null;
}

// ── Rate Limiting (KV-backed) ───────────────
async function checkRateLimit(ip, env) {
  const kv = env.RATE_LIMITS;
  if (!kv) return { allowed: true }; // KV not configured — skip (dev mode)

  const now = new Date();
  const hourKey = `ip:${ip}:${Math.floor(now.getTime() / (PER_IP_WINDOW_SEC * 1000))}`;
  const dayKey = `global:${now.toISOString().slice(0, 10)}`;

  // Check per-IP
  const ipCount = parseInt(await kv.get(hourKey) || '0', 10);
  if (ipCount >= PER_IP_LIMIT) {
    const secsLeft = PER_IP_WINDOW_SEC - (Math.floor(now.getTime() / 1000) % PER_IP_WINDOW_SEC);
    return { allowed: false, retryAfter: secsLeft, reason: 'ip' };
  }

  // Check global daily
  const globalCount = parseInt(await kv.get(dayKey) || '0', 10);
  if (globalCount >= GLOBAL_DAILY_LIMIT) {
    return { allowed: false, retryAfter: 3600, reason: 'global' };
  }

  // Increment both
  await kv.put(hourKey, String(ipCount + 1), { expirationTtl: PER_IP_WINDOW_SEC });
  await kv.put(dayKey, String(globalCount + 1), { expirationTtl: 86400 });

  return { allowed: true, ipCount: ipCount + 1, globalCount: globalCount + 1 };
}

// ── HTML → Text ─────────────────────────────
function stripHtml(html) {
  // Remove script, style, nav, footer, header tags and content
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Replace block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  // Truncate to 15000 chars
  return text.slice(0, 15000);
}

// ── Validate extracted JSON ─────────────────
function validateExtraction(data) {
  if (!data || typeof data !== 'object') return null;

  // Ensure scores exist with defaults
  const scores = data.scores || {};
  const validScores = {};
  for (const dim of ['heatSource', 'loylyQuality', 'communalAtmosphere', 'waterAccess', 'noFrills', 'tradition', 'overall']) {
    const v = Number(scores[dim]);
    validScores[dim] = (Number.isFinite(v) && v >= 0 && v <= 10) ? Math.round(v) : 5;
  }

  // Validate type
  let type = String(data.type || 'other').toLowerCase();
  if (!SAUNA_TYPES.includes(type)) type = 'other';

  return {
    name: typeof data.name === 'string' ? data.name : null,
    city: typeof data.city === 'string' ? data.city : null,
    country: typeof data.country === 'string' ? data.country : null,
    address: typeof data.address === 'string' ? data.address : null,
    type,
    hours: typeof data.hours === 'string' ? data.hours : null,
    price: typeof data.price === 'string' ? data.price : null,
    website: typeof data.website === 'string' ? data.website : null,
    highlights: typeof data.highlights === 'string' ? data.highlights : null,
    nude: typeof data.nude === 'boolean' ? data.nude : null,
    scores: validScores,
  };
}

// ── Main Handler ────────────────────────────
export default {
  async fetch(request, env) {
    const origin = checkOrigin(request);
    if (!origin) {
      return new Response('Forbidden', { status: 403 });
    }

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders(origin),
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/extract') {
      return new Response('Not found', {
        status: 404,
        headers: corsHeaders(origin),
      });
    }

    try {
      // Parse body
      const body = await request.json();
      const targetUrl = body?.url;

      if (!targetUrl || typeof targetUrl !== 'string') {
        return Response.json({ error: 'Missing or invalid "url" field' }, {
          status: 400,
          headers: corsHeaders(origin),
        });
      }

      // Validate URL
      try {
        const parsed = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        return Response.json({ error: 'Invalid URL' }, {
          status: 400,
          headers: corsHeaders(origin),
        });
      }

      if (targetUrl.length > 2048) {
        return Response.json({ error: 'URL too long' }, {
          status: 400,
          headers: corsHeaders(origin),
        });
      }

      // Rate limiting
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateCheck = await checkRateLimit(ip, env);
      if (!rateCheck.allowed) {
        const msg = rateCheck.reason === 'global'
          ? 'Daily extraction limit reached. Try again tomorrow or fill in manually.'
          : 'Rate limit exceeded. Try again later or fill in manually.';
        return Response.json({ error: msg }, {
          status: 429,
          headers: {
            ...corsHeaders(origin),
            'Retry-After': String(rateCheck.retryAfter),
          },
        });
      }

      // Fetch the target page
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let pageResponse;
      try {
        pageResponse = await fetch(targetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 SaunaFinder/1.0' },
          signal: controller.signal,
          redirect: 'follow',
        });
      } catch (err) {
        return Response.json({ error: 'Could not fetch the URL. The site may be blocking requests.' }, {
          status: 502,
          headers: corsHeaders(origin),
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!pageResponse.ok) {
        return Response.json({ error: `Page returned ${pageResponse.status}. Check the URL.` }, {
          status: 400,
          headers: corsHeaders(origin),
        });
      }

      const html = await pageResponse.text();
      const pageText = stripHtml(html);

      if (pageText.length < 50) {
        return Response.json({ error: 'Page has too little text content to extract from.' }, {
          status: 422,
          headers: corsHeaders(origin),
        });
      }

      // Call Claude API
      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: USER_PROMPT_TEMPLATE(targetUrl, pageText) }],
        }),
      });

      if (!claudeResponse.ok) {
        console.error('Claude API error:', claudeResponse.status, await claudeResponse.text());
        return Response.json({ error: 'Extraction service error. Please fill in manually.' }, {
          status: 502,
          headers: corsHeaders(origin),
        });
      }

      const claudeData = await claudeResponse.json();
      const responseText = claudeData?.content?.[0]?.text || '';

      // Parse JSON from Claude's response (handle possible markdown fences)
      let extracted;
      try {
        const jsonStr = responseText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
        extracted = JSON.parse(jsonStr);
      } catch {
        return Response.json({ error: 'Could not parse extraction result. Please fill in manually.' }, {
          status: 422,
          headers: corsHeaders(origin),
        });
      }

      // Validate and sanitize
      const validated = validateExtraction(extracted);
      if (!validated) {
        return Response.json({ error: 'Extraction returned invalid data. Please fill in manually.' }, {
          status: 422,
          headers: corsHeaders(origin),
        });
      }

      return Response.json(validated, {
        status: 200,
        headers: corsHeaders(origin),
      });

    } catch (err) {
      console.error('Worker error:', err);
      return Response.json({ error: 'Internal error. Please try again.' }, {
        status: 500,
        headers: corsHeaders(origin),
      });
    }
  },
};
