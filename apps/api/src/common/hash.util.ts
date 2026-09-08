import { createHash, randomUUID } from 'node:crypto';

/** Huella única de una vacante = sha256(url canónica normalizada). */
export function fingerprint(url: string): string {
  return createHash('sha256')
    .update(url.trim().replace(/\s+/g, ' '))
    .digest('hex');
}

export function newRequestId(): string {
  return randomUUID();
}
