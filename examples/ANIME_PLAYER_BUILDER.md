# Bot extractor de player (m3u8 + subtítulos dinámicos)

## Qué resuelve
Este bot reemplaza `curl` y usa SecretAgent (navegador real) para capturar:
- `videoUrl` (`.m3u8`)
- subtítulos dinámicos (`.vtt` / `.srt`)

También mejora el matching de episodios para evitar duplicados (capítulos repetidos) y añade un paso clave para páginas con bloques `1-10`, `11-20`, etc.: primero selecciona bloque y luego episodio.

## Archivos
- `examples/anime-player-builder.js` (bot VPS)
- Snippet de integración Worker/Nitro (abajo)

## API del bot VPS
`POST /`:
```json
{ "url": "https://sitio/serie/temporada-3", "ep": "3-2" }
```

Respuesta:
```json
{
  "ok": true,
  "videoUrl": "https://cdn/video/master.m3u8",
  "subtitles": [{ "label": "es latin", "src": "https://cdn/es.vtt", "srclang": "es" }]
}
```

## Montaje recomendado (Cloudflare + VPS)
1. **VPS**: ejecuta el bot SecretAgent (no corre dentro de Worker).
2. **Cloudflare Worker**: recibe del frontend, consulta KV, y si no hay caché hace `fetch` al VPS.
3. **Frontend**: solo consulta tu endpoint del Worker.

## Cómo conectarlo a tu API actual
Usa el snippet de abajo para migrar de `embed` a:
- `videoUrl`
- `subtitles`

Compatibilidad sugerida temporal:
- devolver también `embed: videoUrl` en tu API final mientras actualizas frontend.

## Deploy rápido
### VPS
```bash
npm install
node examples/anime-player-builder.js
```
Variables:
- `PORT=3000`
- `HOST=0.0.0.0`
- `REQUEST_TIMEOUT_MS=45000`

### Cloudflare Worker (Wrangler)
```bash
npm i -D wrangler
npx wrangler login
npx wrangler kv namespace create ANIME_CACHE
```
En `wrangler.toml` enlaza el KV namespace y despliega:
```bash
npx wrangler deploy
```

## Recomendaciones anti-errores en animes largos
- TTL de KV por episodio (`anime:url:ep`) entre 10 y 30 min.
- Timeout del bot entre 45s y 60s.
- Retries (1-2) desde Worker al VPS cuando falle por red.
- Si el sitio cambia HTML, ajustar selectores en `clickEpisodeGroupIfNeeded` y `findEpisodeCandidate`.


## Snippet Worker/Nitro (adaptación de tu archivo actual)
```ts
const BOT_URL = "https://TU-BOT-VPS.com";
// ... mantiene tu flujo KV -> seeke -> bot -> fallback
const botRes = await fetch(BOT_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: baseUrl, ep: String(ep) }),
});
const data = await botRes.json();
if (data?.ok && data.videoUrl?.includes(".m3u8")) {
  return {
    ok: true,
    episode: String(ep),
    videoUrl: data.videoUrl,
    embed: data.videoUrl, // compat temporal con frontend viejo
    subtitles: data.subtitles ?? [],
    source: "bot",
  };
}
```
