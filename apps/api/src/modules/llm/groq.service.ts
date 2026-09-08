import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { JsonLogger } from '../../common/json-logger.service';
import { LlmProvider } from './llm-provider.port';

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const TIMEOUT_MS = 90_000;

interface GroqChoice {
  message?: { content?: string };
}

@Injectable()
export class GroqLlmService implements LlmProvider {
  readonly name = 'groq';

  constructor(private readonly logger: JsonLogger) {}

  async json(system: string, user: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: env.GROQ_MODEL,
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
        throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as { choices?: GroqChoice[] };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Groq: respuesta sin contenido');

      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Groq: respuesta no es JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      this.logger.error(
        { msg: 'Groq call failed', err: String(err) },
        GroqLlmService.name,
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
