import { Injectable } from '@nestjs/common';
import { LlmProvider } from './llm-provider.port';

/**
 * Proveedor mock: devuelve null para que cada etapa del pipeline use su
 * resultado determinístico de respaldo (E2E sin llave ni red).
 */
@Injectable()
export class MockLlmService implements LlmProvider {
  readonly name = 'mock';
  async json(): Promise<null> {
    return null;
  }
}
