import { zodToJsonSchema } from 'zod-to-json-schema';
import { ModelProvider, ModelRequest, ModelResult } from './interface';

type MeshResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  model?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

type Fetcher = typeof fetch;
// zod-to-json-schema's recursive public type can exceed TypeScript's generic
// instantiation limit for the generic ModelRequest<T>. The runtime function is
// still invoked directly; this boundary only erases that library's type-level
// recursion at the provider boundary.
const toJsonSchema = zodToJsonSchema as unknown as (schema: unknown, options: { $refStrategy: 'none' }) => Record<string, unknown>;

/**
 * Mesh's OpenAI-compatible chat endpoint with provider-enforced JSON Schema
 * output. The adapter still parses and validates locally: provider adherence is
 * useful, but never a trust boundary for payment operations.
 */
export class MeshModelAdapter implements ModelProvider {
  constructor(
    private readonly apiKey: string,
    private readonly modelId = process.env.MESH_MODEL?.trim() || 'openai/gpt-4o-mini-2024-07-18',
    private readonly timeoutMs = 3_000,
    private readonly endpoint = 'https://api.meshapi.ai/v1/chat/completions',
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async complete<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
    if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 1 || request.maxTokens > 768) throw new Error('Model output token budget must be between 1 and 768');
    assertInputWithinBudget(`${request.systemPrompt}\n\n${request.userContent}`, request.maxInputTokens);
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.modelId,
        temperature: 0,
        max_tokens: request.maxTokens,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userContent },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'payscope_structured_response',
            strict: true,
            schema: toJsonSchema(request.responseSchema, { $refStrategy: 'none' }),
          },
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await response.json().catch(() => ({})) as MeshResponse;
    if (!response.ok) throw new Error(`Mesh model request failed (${response.status})`);
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Mesh model response did not include structured content');
    let parsed: unknown;
    try { parsed = JSON.parse(stripSingleJsonFence(content)); } catch { throw new Error('Mesh model response was not valid JSON'); }
    return {
      content: request.responseSchema.parse(parsed),
      usage: { inputTokens: safeNumber(payload.usage?.prompt_tokens), outputTokens: safeNumber(payload.usage?.completion_tokens) },
      modelId: typeof payload.model === 'string' ? payload.model : this.modelId,
    };
  }
}

export function assertInputWithinBudget(content: string, maxInputTokens: number): void {
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens <= 0) throw new Error('Model input token budget must be a positive integer');
  if (Buffer.byteLength(content, 'utf8') > maxInputTokens * 4) throw new Error('Model input exceeds its configured token budget');
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function stripSingleJsonFence(content: string): string {
  const match = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : content;
}
