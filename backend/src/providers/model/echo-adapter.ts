import { ModelProvider, ModelRequest, ModelResult } from './interface';

/** Offline deterministic adapter used by fixtures and tests. */
export class EchoModelAdapter implements ModelProvider {
  constructor(private readonly outputFor: (request: { systemPrompt: string; userContent: string }) => unknown) {}

  async complete<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
    if (!Number.isSafeInteger(request.maxInputTokens) || request.maxInputTokens < 1 || Buffer.byteLength(`${request.systemPrompt}\n\n${request.userContent}`, 'utf8') > request.maxInputTokens * 4) throw new Error('Fixture model input exceeds its configured token budget');
    if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 1 || request.maxTokens > 768) throw new Error('Fixture model output token budget must be between 1 and 768');
    const output = this.outputFor(request);
    if (Buffer.byteLength(JSON.stringify(output), 'utf8') > request.maxTokens * 4) throw new Error('Fixture model output exceeds its configured token budget');
    return {
      content: request.responseSchema.parse(output),
      usage: { inputTokens: 0, outputTokens: 0 },
      modelId: 'echo-fixture-v1',
    };
  }
}
