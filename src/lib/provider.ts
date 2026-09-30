import Anthropic from "@anthropic-ai/sdk";
import {
  ANTHROPIC_VERSION,
  MAX_RETRIES,
  MAX_TOKENS,
  OPENROUTER_BASE_URL,
  TEMPERATURE,
} from "./rubric";

export type Provider = "anthropic" | "openrouter" | "mock";

export class ModelError extends Error {
  stop_reason?: string;
  constructor(message: string, stopReason?: string) {
    super(message);
    this.name = "ModelError";
    this.stop_reason = stopReason;
  }
}

export function getProvider(): Provider {
  if ((process.env.OPENROUTER_API_KEY || "").trim()) return "openrouter";
  if ((process.env.ANTHROPIC_API_KEY || "").trim()) return "anthropic";
  return "mock";
}

export type ToolSpec = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type CallOptions = {
  system: string;
  user: string;
  tool: ToolSpec;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Optional fallback model if the primary id is rejected by the API. */
  fallbackModel?: string;
};

export type CallResult = {
  input: unknown;
  meta: { model: string; stop_reason?: string; usage?: Record<string, unknown> };
};

/**
 * Provider-agnostic forced-tool call. Anthropic Messages API + tool_use, or an
 * OpenAI-compatible function call via OpenRouter. Never returns partial output:
 * truncation throws a ModelError.
 */
export async function callTool(opts: CallOptions): Promise<CallResult> {
  const provider = getProvider();
  const startedAt = Date.now();
  console.log("[pts:model] request started", {
    provider,
    tool: opts.tool.name,
    model: opts.model,
    userChars: opts.user.length,
    schemaFields: Object.keys((opts.tool.input_schema.properties as Record<string, unknown> | undefined) ?? {}),
  });
  try {
    const result = provider === "openrouter"
      ? await callViaOpenRouter(opts)
      : provider === "anthropic"
        ? await callViaAnthropic(opts)
        : (() => { throw new ModelError("No model provider configured."); })();
    console.log("[pts:model] request completed", { provider, tool: opts.tool.name, model: result.meta.model, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error("[pts:model] request failed", {
      provider,
      tool: opts.tool.name,
      model: opts.model,
      durationMs: Date.now() - startedAt,
      errorClass: e.constructor.name,
      errorName: e.name,
      errorMessage: e.message,
      stack: e.stack,
    });
    throw error;
  }
}

function isBadModel(status: number, body: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422) return false;
  return /model|not found|invalid|unknown/i.test(body);
}

async function callViaAnthropic(opts: CallOptions): Promise<CallResult> {
  const client = new Anthropic({
    apiKey: (process.env.ANTHROPIC_API_KEY || "").trim(),
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    maxRetries: MAX_RETRIES,
    defaultHeaders: { "anthropic-version": ANTHROPIC_VERSION },
  });

  const models = [opts.model, opts.fallbackModel].filter(Boolean) as string[];
  let lastErr: unknown;
  for (const model of models) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? MAX_TOKENS,
        temperature: opts.temperature ?? TEMPERATURE,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        tools: [opts.tool as unknown as Anthropic.Tool],
        tool_choice: { type: "tool", name: opts.tool.name },
      });
      console.log(
        `[pts] anthropic model=${response.model} stop_reason=${response.stop_reason} usage=${JSON.stringify(response.usage ?? {})}`,
      );
      if (response.stop_reason === "max_tokens") {
        throw new ModelError("Model output truncated (max_tokens). Increase max_tokens and retry.", "max_tokens");
      }
      for (const block of response.content) {
        if (block.type === "tool_use" && block.name === opts.tool.name) {
          return {
            input: block.input,
            meta: {
              model: response.model || model,
              stop_reason: response.stop_reason ?? undefined,
              usage: (response.usage ?? {}) as unknown as Record<string, unknown>,
            },
          };
        }
      }
      throw new ModelError("Model returned no structured tool call.", response.stop_reason ?? undefined);
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status ?? 0;
      const msg = e instanceof Error ? e.message : String(e);
      if (model !== models[models.length - 1] && isBadModel(status, msg)) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ModelError("Anthropic call failed.");
}

type OpenRouterResponse = {
  model?: string;
  usage?: Record<string, unknown>;
  choices?: {
    finish_reason?: string;
    message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] };
  }[];
};

async function callViaOpenRouter(opts: CallOptions): Promise<CallResult> {
  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  const models = [opts.model, opts.fallbackModel].filter(Boolean) as string[];

  for (const model of models) {
    const payload = {
      model,
      temperature: opts.temperature ?? TEMPERATURE,
      max_tokens: opts.maxTokens ?? MAX_TOKENS,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      tools: [
        {
          type: "function",
          function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema },
        },
      ],
      tool_choice: { type: "function", function: { name: opts.tool.name } },
    };

    let lastError = "";
    let badModel = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://pts-100.local",
          "X-Title": "PTS Publication Trust Score",
        },
        body: JSON.stringify(payload),
      });

      if ([429, 500, 502, 503, 529].includes(res.status)) {
        lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
        await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 20000)));
        continue;
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 500);
        if (isBadModel(res.status, body) && model !== models[models.length - 1]) {
          badModel = true;
          break;
        }
        throw new Error(`OpenRouter error HTTP ${res.status}: ${body}`);
      }

      const data = (await res.json()) as OpenRouterResponse;
      const finishReason = data.choices?.[0]?.finish_reason;
      console.log(
        `[pts] openrouter model=${data.model} finish_reason=${finishReason} usage=${JSON.stringify(data.usage ?? {})}`,
      );
      if (finishReason === "length") {
        throw new ModelError("Model output truncated (length). Increase max_tokens and retry.", "length");
      }
      const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
      if (!call?.arguments) {
        throw new ModelError("Model returned no structured tool call.", finishReason);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(call.arguments);
      } catch {
        throw new ModelError(
          "Model tool arguments were not valid JSON" + (finishReason === "length" ? " (output truncated)." : "."),
          finishReason,
        );
      }
      return { input: parsed, meta: { model: data.model || model, stop_reason: finishReason, usage: data.usage ?? {} } };
    }
    if (badModel) continue;
    throw new Error(`OpenRouter unavailable after ${MAX_RETRIES} attempts. Last error: ${lastError}`);
  }
  throw new ModelError("OpenRouter call failed for all candidate models.");
}
