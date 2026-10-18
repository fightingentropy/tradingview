import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

export const CLAUDE_MODEL = 'claude-opus-5-5';
// Routes a safety-classifier decline to Anthropic's recommended fallback model.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_PAUSE_CONTINUATIONS = 8;

export type ClaudeRequest = Omit<BetaMessageStreamParams, 'model' | 'betas' | 'fallbacks'>;

export function createClaudeClient(
  apiKey: string | undefined,
  { timeoutMs, maxRetries = 2 }: { timeoutMs: number; maxRetries?: number },
): Anthropic {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured for this Worker');
  return new Anthropic({ apiKey, timeout: timeoutMs, maxRetries });
}

/**
 * Streams one assistant turn and resumes server-tool pauses. Returns the final
 * message and the append-only transcript, so callers can answer a tool call.
 */
export async function runClaudeTurn(
  client: Anthropic,
  request: ClaudeRequest,
  label: string,
): Promise<{ message: BetaMessage; messages: BetaMessageParam[] }> {
  let messages = request.messages;
  for (let pause = 0; ; pause += 1) {
    const message = await client.beta.messages.stream({
      ...request,
      messages,
      model: CLAUDE_MODEL,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    }).finalMessage();
    messages = [...messages, { role: 'assistant', content: message.content }];
    console.log(JSON.stringify({
      event: 'claude_usage',
      label,
      model: message.model,
      stopReason: message.stop_reason,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens,
      cacheWriteTokens: message.usage.cache_creation_input_tokens,
      serverToolUse: message.usage.server_tool_use ?? null,
    }));
    if (message.stop_reason === 'pause_turn' && pause < MAX_PAUSE_CONTINUATIONS) continue;
    if (message.stop_reason === 'refusal') {
      throw new Error(`Claude declined the ${label} request (${message.stop_details?.category ?? 'unspecified'})`);
    }
    if (message.stop_reason === 'max_tokens') throw new Error(`Claude hit max_tokens during ${label}`);
    if (message.stop_reason === 'pause_turn') throw new Error(`Claude kept pausing during ${label}`);
    return { message, messages };
  }
}
