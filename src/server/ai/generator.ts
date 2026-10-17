// Provider-agnostic text generation (ADR-0007). The copy assistant only ever sees salon-level
// facts and placeholders, never customer personal data (ai-design.md §4).
import { z } from "zod";

export type CopyGoal = "winback" | "birthday" | "promotion" | "reactivation" | "thank_you";
export type CopyTone = "friendly" | "professional" | "playful";

export type CopyRequest = {
  goal: CopyGoal;
  tone: CopyTone;
  maxLength: number;
  salonName: string;
  promotion: { description: string } | null;
  ownerBrief?: string;
  language?: string;
};

export const DraftsSchema = z.object({
  drafts: z.array(z.object({ text: z.string() })).min(1).max(3),
});

export type Generation = {
  drafts: string[];
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

export interface TextGenerator {
  readonly provider: string;
  readonly model: string;
  draft(req: CopyRequest, signal?: AbortSignal): Promise<Generation>;
}

export class AIRefusalError extends Error {}
