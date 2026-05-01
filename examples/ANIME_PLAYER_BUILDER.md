# Bot extractor de player (m3u8 + subtítulos dinámicos)

## Qué resuelve
Este bot reemplaza el enfoque con `curl` y usa SecretAgent para ejecutar JS real de la página. Así puede capturar:

- URL final de video `.m3u8`.
- Subtítulos dinámicos `.vtt` o `.srt` cargados después del render.

Además, mejora la selección de episodios para evitar repetición de capítulos (ejemplo: 3-1, 3-2, 3-3, etc.) porque busca y puntúa múltiples atributos (`textContent`, `href`, `data-episode`, `data-id`).

## Archivo
- `examples/anime-player-builder.js`

## API HTTP esperada
`POST /` con JSON:

```json
{
  "url": "https://sitio-clon-anime.com/serie/black-clover/temporada-3",
  "ep": "3-2"
}
```

Respuesta:

```json
{
  "ok": true,
  "videoUrl": "https://cdn.../master.m3u8",
  "subtitles": [
    {
      "label": "es latin",
      "src": "https://cdn.../es-latin.vtt",
      "srclang": "es"
    }
  ]
}
```

## Integración con Cloudflare Worker
Tu Worker debe seguir como puente:

1. Recibe request del frontend.
2. Valida parámetros.
3. Consulta KV cache con llave: `anime:${url}:${ep}`.
4. Si no existe, hace `fetch` POST a tu VPS (`http://TU_VPS:3000`).
5. Guarda respuesta en KV (TTL 5-30 min).
6. Devuelve JSON al frontend.

## Dónde montarlo
Como SecretAgent necesita navegador real, **no** corre dentro de Cloudflare Workers. Opciones recomendadas:

- VPS (Hetzner, Contabo, DigitalOcean, OVH).
- Railway con instancia dedicada + memoria suficiente.
- Render background service (si permite Chromium dependencias).
- Tu actual JustRunMyApp si soporta proceso largo + dependencias del navegador.

## Ejecución en VPS
```bash
npm install
node examples/anime-player-builder.js
```

Variables opcionales:
- `PORT` (default `3000`)
- `HOST` (default `0.0.0.0`)
- `REQUEST_TIMEOUT_MS` (default `45000`)

## Nota de robustez para animes largos
Para catálogos con cientos de episodios:
- Mantén timeout de 45s-60s.
- Haz caché por episodio en Worker KV.
- Si el sitio usa paginación por bloques (1-10, 11-20), primero selecciona el bloque por rango y luego episodio exacto (puedes extender `findEpisodeCandidate` con ese paso).
