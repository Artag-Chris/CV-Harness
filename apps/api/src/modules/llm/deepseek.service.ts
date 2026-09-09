import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { JsonLogger } from '../../common/json-logger.service';
import { LlmProvider } from './llm-provider.port';

/**
 * Adaptador DeepSeek (API compatible con OpenAI).
 * - Base: https://api.deepseek.com/v1/chat/completions
 * - Modelo por env DEEPSEEK_MODEL (deepseek-chat | deepseek-reasoner)
 * - JSON mode soportado con response_format: { type: 'json_object' }
 *
 * Agregar otro proveedor = implementar el mismo puerto LlmProvider y
 * registrarlo en llm.module.ts (factory por env). Nada más se toca.
 */
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const TIMEOUT_MS = 90_000;

interface ChatChoice {
  message?: { content?: string };
}

@Injectable()
export class DeepSeekLlmService implements LlmProvider {
  readonly name = 'deepseek';

  constructor(private readonly logger: JsonLogger) {}

  async json(system: string, user: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: env.DEEPSEEK_MODEL,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as { choices?: ChatChoice[] };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('DeepSeek: respuesta sin contenido');

      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('DeepSeek: respuesta no es JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      this.logger.error(
        { msg: 'DeepSeek call failed', err: String(err) },
        DeepSeekLlmService.name,
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
