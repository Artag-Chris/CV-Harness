/**
 * Puerto del proveedor LLM. json() devuelve la respuesta como objeto JSON;
 * devuelve null cuando el modo es 'mock' (sin llave configurada): el llamador
 * usa entonces su resultado determinístico de respaldo.
 */
export interface LlmProvider {
  readonly name: string;
  json(system: string, user: string): Promise<Record<string, unknown> | null>;
}
