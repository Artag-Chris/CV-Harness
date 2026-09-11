import { createHash, randomUUID } from 'node:crypto';

/** Huella única de una vacante = sha256(url canónica normalizada). */
export function fingerprint(url: string): string {
  return createHash('sha256')
    .update(url.trim().replace(/\s+/g, ' '))
    .digest('hex');
}

/**
 * Huella para vacantes sin URL (ofertas pegadas a mano): sha256 del texto
 * normalizado. Permite deduplicar el mismo pegado sin depender de una URL.
 */
export function fingerprintText(text: string): string {
  return createHash('sha256')
    .update(`manual:${text.trim().replace(/\s+/g, ' ')}`)
    .digest('hex');
}

export function newRequestId(): string {
  return randomUUID();
}
