// Generator implementations. AI_PROVIDER=fake (default, no network) | anthropic.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AIRefusalError, DraftsSchema, type CopyRequest, type Generation, type TextGenerator } from "./generator";
import { COPY_SYSTEM, copyUserMessage } from "./prompts";

/** USD per million tokens (input, output). Update with the provider's price list. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [i, o] = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return Math.round(inputTokens * i + outputTokens * o); // per-MTok USD × tokens = micro-USD
}

/** Deterministic drafts for development, tests and the eval harness's self-test. */
export class FakeGenerator implements TextGenerator {
  readonly provider = "fake";
  readonly model = "fake";
  async draft(req: CopyRequest): Promise<Generation> {
    const offer = req.promotion ? " {{offer}}" : "";
    const byGoal: Record<CopyRequest["goal"], string[]> = {
      winback: [
        `Hi {{first_name}}, it's {{salon_name}}. It's been {{weeks_since_visit}} weeks since your last cut with {{barber_name}}.${offer} Fancy a fresh one this week? {{booking_link}}`,
        `Hi {{first_name}}, ready for a fresh cut?${offer} {{barber_name}} has times this week: {{booking_link}}`,
        `{{first_name}}, we've kept your chair warm at {{salon_name}}.${offer} Book in under a minute: {{booking_link}}`,
      ],
      birthday: [
        `Happy birthday {{first_name}}! Everyone at {{salon_name}} wishes you a great day.${offer} {{booking_link}}`,
        `Happy birthday from {{salon_name}}, {{first_name}}.${offer} Come and see us soon: {{booking_link}}`,
      ],
      promotion: [
        `Hi {{first_name}}, there's something on at {{salon_name}} this week.${offer}`,
        `{{first_name}}, a little something from {{salon_name}}:${offer} We'd love to see you.`,
      ],
      reactivation: [`Hi {{first_name}}, it's {{salon_name}}. It's been a while, and we'd love to see you again.${offer} {{booking_link}}`],
      thank_you: [`Thanks for coming in today, {{first_name}}. See you next time at {{salon_name}}.`],
    };
    return { drafts: byGoal[req.goal], provider: this.provider, model: this.model, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 };
  }
}

export class AnthropicGenerator implements TextGenerator {
  readonly provider = "anthropic";
  constructor(
    readonly model = process.env.AI_MODEL || "claude-opus-5-5",
    private readonly client = new Anthropic(),
  ) {}

  async draft(req: CopyRequest, signal?: AbortSignal): Promise<Generation> {
    const response = await this.client.beta.messages.parse(
      {
        model: this.model,
        max_tokens: 2000,
        // On a policy decline the API retries on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // A short copy-writing task: low effort keeps it fast and cheap.
        output_config: { effort: "low", format: betaZodOutputFormat(DraftsSchema) },
        system: COPY_SYSTEM,
        messages: [{ role: "user", content: copyUserMessage(req) }],
      },
      { signal, timeout: 15_000, maxRetries: 1 },
    );
    if (response.stop_reason === "refusal") throw new AIRefusalError("The model declined this request.");
    const parsed = response.parsed_output;
    if (!parsed) throw new Error("The model's answer didn't match the expected format.");
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    return {
      drafts: parsed.drafts.map((d) => d.text.trim()),
      provider: this.provider,
      model: response.model,
      inputTokens,
      outputTokens,
      costMicroUsd: costMicroUsd(response.model, inputTokens, outputTokens),
    };
  }
}

export function getGenerator(): TextGenerator {
  const provider = process.env.AI_PROVIDER ?? "fake";
  if (provider === "anthropic") return new AnthropicGenerator();
  if (provider === "fake") return new FakeGenerator();
  throw new Error(`AI_PROVIDER=${provider} has no adapter yet (ADR-0007).`);
}
