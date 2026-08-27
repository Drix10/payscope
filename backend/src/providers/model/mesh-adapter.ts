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
    private readonly modelId = process.env.MESH_MODEL?.trim() || 'nex-agi/nex-n2-mini',
    private readonly timeoutMs = 25_000,
    private readonly endpoint = 'https://api.meshapi.ai/v1/chat/completions',
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async complete<T>(request: ModelRequest<T>): Promise<ModelResult<T>> {
    // Reasoning models emit hidden reasoning tokens before any JSON content.
    // The output budget must accommodate reasoning + structured content, or
    // every response finishes with reason "length" and empty content.
    if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 1 || request.maxTokens > 8192) throw new Error('Model output token budget must be between 1 and 8192');
    if (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1)) throw new Error('Model request timeout must be a positive integer');
    assertInputWithinBudget(`${request.systemPrompt}\n\n${request.userContent}`, request.maxInputTokens);
    const timeoutMs = request.timeoutMs !== undefined ? request.timeoutMs : this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.modelId,
          temperature: 0,
          max_tokens: Math.max(request.maxTokens ?? 8192, 8192),
          messages: [
            { role: 'system', content: `${request.systemPrompt}\nBe extremely concise. Output JSON immediately.` },
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
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const payload = await response.json().catch(() => ({})) as MeshResponse;
    if (!response.ok) throw new Error(`Mesh model request failed (${response.status})`);
    const content = payload.choices?.[0]?.message?.content;
    let parsed: unknown;
    if (content && typeof content === 'object') {
      parsed = content;
    } else if (typeof content === 'string') {
      const repaired = repairJsonString(content);
      try {
        parsed = JSON.parse(repaired);
      } catch {
        throw new Error('Mesh model response was not valid JSON');
      }
    } else {
      throw new Error('Mesh model response did not include structured content');
    }
    let targetObj = parsed;
    let validated = request.responseSchema.safeParse(targetObj);
    if (!validated.success && targetObj && typeof targetObj === 'object' && !Array.isArray(targetObj)) {
      const rec = targetObj as Record<string, unknown>;
      const innerKey = ['data', 'plan', 'analysis', 'output', 'result', 'riskAnalysis', 'response', 'structuredOutput'].find(k => rec[k] && typeof rec[k] === 'object');
      if (innerKey) {
        targetObj = rec[innerKey];
        validated = request.responseSchema.safeParse(targetObj);
      }
    }
    if (!validated.success) {
      throw validated.error;
    }
    return {
      content: validated.data,
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

function repairJsonString(input: string): string {
  let str = stripSingleJsonFence(input);
  try {
    JSON.parse(str);
    return str;
  } catch {
    // Continue to repair truncated or malformed JSON
  }

  // Handle unclosed trailing quote
  const quoteMatches = str.match(/(?<!\\)"/g);
  if (quoteMatches && quoteMatches.length % 2 !== 0) {
    str += '"';
  }

  // Remove trailing commas before closing braces/brackets or end of string
  str = str.replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/g, '');

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') openBraces++;
      else if (char === '}') openBraces = Math.max(0, openBraces - 1);
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  while (openBrackets > 0) {
    str += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    str += '}';
    openBraces--;
  }

  try {
    JSON.parse(str);
    return str;
  } catch {
    return stripSingleJsonFence(input);
  }
}

function stripSingleJsonFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match && match[1].trim()) return match[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
