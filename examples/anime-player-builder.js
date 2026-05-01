const http = require('http');
const SecretAgent = require('secret-agent');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 45000);

function normalizeEpisodeKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^0+(\d)$/,'$1').replace(/\s+/g, '');
}

function episodeScore(input, ep) {
  const text = String(input ?? '').toLowerCase().trim();
  const target = normalizeEpisodeKey(ep).toLowerCase();
  if (!text || !target) return 0;

  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(`^${escaped}$`);
  const seasonLike = new RegExp(`(^|\\b|[^\\d])${escaped}($|\\b|[^\\d])`);

  if (exact.test(text)) return 100;
  if (text === `episodio ${target}` || text === `episode ${target}`) return 90;
  if (seasonLike.test(text)) return 70;
  if (text.includes(target)) return 50;
  return 0;
}

async function findEpisodeCandidate(agent, episodeInput) {
  const target = normalizeEpisodeKey(episodeInput);

  const candidates = await agent.document.querySelectorAll('a, button, li, [role="button"], .episode, .capitulo, .chapter');
  let best = null;

  for (const node of candidates) {
    const text = await node.textContent;
    const href = await node.getAttribute('href');
    const dataEpisode = await node.getAttribute('data-episode');
    const dataId = await node.getAttribute('data-id');

    const scores = [
      episodeScore(text, target),
      episodeScore(href, target),
      episodeScore(dataEpisode, target),
      episodeScore(dataId, target),
    ];
    const score = Math.max(...scores);

    if (!best || score > best.score) {
      best = { node, score, text, href };
    }
  }

  if (best && best.score >= 70) {
    await best.node.click();
    return best;
  }

  return null;
}


function extractEpisodeNumber(value) {
  const normalized = normalizeEpisodeKey(value);
  const match = normalized.match(/(\d+)(?:[-x_.](\d+))?$/i);
  if (!match) return null;
  return {
    season: match[2] ? Number(match[1]) : null,
    episode: Number(match[2] || match[1]),
  };
}

function inRangeLabel(label, episode) {
  const text = String(label ?? '').trim();
  const range = text.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!range) return false;
  const start = Number(range[1]);
  const end = Number(range[2]);
  return Number.isFinite(start) && Number.isFinite(end) && episode >= start && episode <= end;
}

async function clickEpisodeGroupIfNeeded(agent, episodeInput) {
  const parsed = extractEpisodeNumber(episodeInput);
  if (!parsed?.episode) return false;

  const groupButtons = await agent.document.querySelectorAll('a, button, li, [role="button"], .page-item, .episode-range');
  for (const node of groupButtons) {
    const text = await node.textContent;
    if (inRangeLabel(text, parsed.episode)) {
      await node.click();
      await agent.waitForMillis(1200);
      return true;
    }
  }

  return false;
}

async function scrapePlayerConfig(baseUrl, episode) {
  const agent = await SecretAgent();
  const subtitlesMap = new Map();
  let videoUrl = null;

  try {
    agent.on('resource', resource => {
      const url = resource.url || '';
      const lower = url.toLowerCase();

      if (lower.includes('.m3u8')) {
        videoUrl = url;
      }

      const isSubtitle = lower.includes('.vtt') || lower.includes('.srt');
      if (!isSubtitle) return;

      const fromPath = url.split('/').pop()?.split('?')[0] ?? 'sub';
      const labelGuess = decodeURIComponent(fromPath)
        .replace(/\.(vtt|srt)$/i, '')
        .replace(/[._-]+/g, ' ')
        .trim() || 'Subtítulo';

      const langMatch = lower.match(/([a-z]{2})(?:[_-]([a-z]{2}))?\.(?:vtt|srt)/i);
      const srclang = langMatch ? `${langMatch[1]}${langMatch[2] ? `-${langMatch[2]}` : ''}` : 'es';

      subtitlesMap.set(url, { label: labelGuess, src: url, srclang });
    });

    await agent.goto(baseUrl);
    await clickEpisodeGroupIfNeeded(agent, episode);
    await findEpisodeCandidate(agent, episode);
    await agent.waitForMillis(5000);

    if (!videoUrl) {
      const foundInDom = await agent.document.documentElement.innerHTML;
      const m3u8Match = String(foundInDom).match(/https?:[^"'\s]+\.m3u8[^"'\s]*/i);
      if (m3u8Match) videoUrl = m3u8Match[0];
    }

    return {
      ok: Boolean(videoUrl),
      videoUrl,
      subtitles: Array.from(subtitlesMap.values()),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      videoUrl: null,
      subtitles: [],
    };
  } finally {
    await agent.close();
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  let body = '';
  req.on('data', chunk => {
    body += chunk.toString('utf8');
  });

  req.on('end', async () => {
    let timer;
    try {
      const { url, ep } = JSON.parse(body);
      if (!url || ep === undefined) return sendJson(res, 400, { ok: false, error: 'Missing url or ep' });

      timer = setTimeout(() => {
        if (!res.headersSent) sendJson(res, 504, { ok: false, error: 'Timeout extracting player' });
      }, REQUEST_TIMEOUT_MS);

      const payload = await scrapePlayerConfig(url, ep);
      if (!res.headersSent) sendJson(res, payload.ok ? 200 : 404, payload);
    } catch (error) {
      if (!res.headersSent) sendJson(res, 400, { ok: false, error: `Invalid request: ${error.message}` });
    } finally {
      clearTimeout(timer);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Anime player builder running at http://${HOST}:${PORT}`);
});
