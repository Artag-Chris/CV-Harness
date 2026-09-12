import { describe, expect, it } from 'vitest';
import { browserHeaders, browserJsonHeaders, diagnoseBlock } from '../src/common/http';
import { looksLikeChallenge } from '../src/modules/sources/probe/fetch';

/**
 * Diagnóstico de bloqueos. Importa que distinga un WAF con challenge (no se
 * arregla con headers) de un 403 normal: el mensaje viejo mandaba a cambiar el
 * User-Agent, que en el caso de Cloudflare no sirve para nada.
 */
const cloudflareChallenge = (status: number) => ({
  get: (name: string) =>
    ({
      'cf-mitigated': 'challenge',
      server: 'cloudflare',
      'cf-ray': 'a3a100130b65713a-BOG',
    })[name.toLowerCase()] ?? null,
});

describe('diagnoseBlock', () => {
  it('reconoce el challenge gestionado de Cloudflare', () => {
    const message = diagnoseBlock(403, cloudflareChallenge(403));
    expect(message).toMatch(/Cloudflare/i);
    expect(message).toMatch(/Turnstile/i);
    expect(message).toMatch(/JavaScript/i);
    expect(message).toMatch(/API\/RSS/i);
  });

  it('reconoce un 403 de Cloudflare sin el header de mitigación', () => {
    const headers = { server: 'cloudflare', 'cf-ray': 'abc-BOG' };
    expect(diagnoseBlock(403, headers)).toMatch(/Cloudflare/i);
  });

  it('un 403 sin WAF habla de huella de cliente, no de User-Agent', () => {
    const message = diagnoseBlock(403, { server: 'nginx' });
    expect(message).toMatch(/403|bloqueó/i);
    expect(message).toMatch(/huella|TLS|IP/i);
  });

  it('explica 401, 429 y 503, y calla en el resto', () => {
    expect(diagnoseBlock(401, {})).toMatch(/autenticación|API key/i);
    expect(diagnoseBlock(429, {})).toMatch(/tasa/i);
    expect(diagnoseBlock(503, {})).toMatch(/no disponible|challenge/i);
    expect(diagnoseBlock(200, {})).toBeNull();
    expect(diagnoseBlock(404, {})).toBeNull();
  });

  it('un 500 del portal se explica como fallo transitorio suyo', () => {
    // Caso real: la API oficial de Jooble devolvió 200 una vez y después 500
    // seguidos (incluso con el ejemplo de su documentación).
    expect(diagnoseBlock(500, { server: 'cloudflare' })).toMatch(/transitorio|reintentá/i);
    expect(diagnoseBlock(502, {})).toMatch(/transitorio/i);
    expect(diagnoseBlock(504, {})).toMatch(/transitorio/i);
  });
});

describe('looksLikeChallenge', () => {
  it('detecta el interstitial de Cloudflare', () => {
    expect(looksLikeChallenge('<title>Un momento…</title><script src="x"></script>')).toBe(true);
    expect(looksLikeChallenge('<div id="cf-chl-widget"></div>')).toBe(true);
  });

  it('no confunde HTML legítimo en español', () => {
    expect(looksLikeChallenge('<h1>Un momento de tu atención</h1><p>Ofertas</p>')).toBe(false);
    expect(looksLikeChallenge('<article class="box_offer">Dev</article>')).toBe(false);
  });
});

describe('cabeceras de navegador', () => {
  it('el set de documento incluye client hints y user-agent de Chrome', () => {
    const headers = browserHeaders();
    expect(headers['User-Agent']).toMatch(/Chrome\/131/);
    expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
    expect(headers['Sec-Fetch-Mode']).toBe('navigate');
  });

  it('el set de API cambia el modo de fetch y pide JSON', () => {
    const headers = browserJsonHeaders();
    expect(headers['Sec-Fetch-Mode']).toBe('cors');
    expect(headers.Accept).toMatch(/application\/json/);
    expect(headers['Content-Type']).toBe('application/json');
  });
});
