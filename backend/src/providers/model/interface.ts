import { z } from 'zod';

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type ModelRequest<T> = {
  systemPrompt: string;
  userContent: string;
  maxInputTokens: number;
  maxTokens: number;
  /** Optional caller deadline; adapters must never exceed their own cap. */
  timeoutMs?: number;
  responseSchema: z.ZodType<T>;
  tenantId: string;
};

export type ModelResult<T> = { content: T; usage: TokenUsage; modelId: string };

/** Model adapters return only schema-validated, bounded structured output. */
export interface ModelProvider {
  complete<T>(request: ModelRequest<T>): Promise<ModelResult<T>>;
}
