export interface LlmCallOptions {
  /** Etapa del pipeline o acción que origina la llamada (para el medidor de gasto). */
  stage?: string;
  /** Override opcional del tope de tokens de salida para esta llamada. */
  maxTokens?: number;
}

export interface LlmTokenUsage {
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
}

export interface LlmJsonWithUsage {
  data: Record<string, unknown>;
  model: string;
  usage: LlmTokenUsage;
}

/**
 * Puerto del proveedor LLM. json() devuelve la respuesta como objeto JSON;
 * devuelve null cuando el modo es 'mock' (sin llave configurada) o cuando se
 * alcanzó el tope diario de consumo: el llamador usa entonces su resultado
 * determinístico de respaldo.
 */
export interface LlmProvider {
  readonly name: string;
  json(
    system: string,
    user: string,
    options?: LlmCallOptions,
  ): Promise<Record<string, unknown> | null>;
  jsonWithUsage?(
    system: string,
    user: string,
    options?: LlmCallOptions,
  ): Promise<LlmJsonWithUsage | null>;
}
