import { createOpenAI } from "npm:@ai-sdk/openai";
import { streamText, type ModelMessage } from "npm:ai";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
export const RESEARCH_MODEL = "openai/gpt-6-astra";

export class AiGatewayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Streams a Responses call and returns the final text. Throws AiGatewayError with the HTTP status. */
export async function runResearchAi(instructions: string, messages: ModelMessage[], signal?: AbortSignal): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new AiGatewayError(401, "AI is not configured.");
  let runId: string | undefined;
  const provider = createOpenAI({
    baseURL: GATEWAY,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set("X-Lovable-AIG-Run-ID", runId);
      const res = await fetch(input, { ...init, headers });
      runId ??= res.headers.get("X-Lovable-AIG-Run-ID") ?? undefined;
      return res;
    },
  });
  let failure: unknown;
  const result = streamText({
    model: provider.responses(RESEARCH_MODEL),
    system: instructions,
    messages,
    abortSignal: signal,
    maxRetries: 0,
    onError: ({ error }) => { failure = error; },
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  let text = "";
  try {
    text = await result.text;
  } catch (e) { failure ??= e; }
  if (failure || !text.trim()) {
    // deno-lint-ignore no-explicit-any
    const f = failure as any;
    const status = Number(f?.statusCode ?? f?.status ?? (failure ? 500 : 200));
    let msg = f?.message ?? "The AI returned no answer.";
    try { const b = JSON.parse(f?.responseBody ?? "{}"); msg = b?.message ?? b?.error?.message ?? msg; } catch { /* keep msg */ }
    throw new AiGatewayError(status || 500, msg);
  }
  return text.trim();
}

export const RESEARCH_INSTRUCTIONS = `You are ParlayFarm's NBA prop research analyst.
Use ONLY the numbers given to you (box score medians, floors, ceilings, hit rates, trends, prop lines, injuries). Never invent stats.
Always write full stat names (Points, Rebounds, Assists, 3-Pointers Made), never abbreviations.
Be direct and short. Mention risk (injury status, small sample, volatile minutes) when relevant. This is research, not a guarantee.`;
