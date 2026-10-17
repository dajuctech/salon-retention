# ADR-0007: Provider-agnostic AI, direct SDK calls, no framework

- Status: Accepted
- Date: 2026-10-16

## Context
v0 named the OpenAI API, "LangChain or LlamaIndex" and pgvector. The R1 AI features are small, single-call text tasks: drafting message copy and describing numbers in plain language. Neither needs retrieval, agents or chains.

## Decision
- Define a `TextGenerator` interface in `src/server/ai/` with one method: input is a prompt version, variables and a JSON schema; output is validated structured output plus usage data.
- Write one adapter per provider using that provider's **official SDK**. The default provider and model are picked by running the eval suite ([evals/README.md](../../evals/README.md)) against candidates. Candidates include the Anthropic API (`claude-opus-5-5` for quality, `claude-haiku-5-5` for low cost) and the OpenAI API. The choice is configured with `AI_PROVIDER` / `AI_MODEL`, so changing provider is a config change once the evals pass.
- **No LangChain or LlamaIndex** in R1. **No pgvector** until there's a retrieval use case (likely R2 feedback search).
- Prompts are files in the repo (`src/server/ai/prompts/*.md`) with version numbers. The prompt version is stored with every generated output.

## Alternatives considered
- **LangChain.** Adds a layer of abstraction and dependencies with no benefit for single calls.
- **Locking in one provider.** Simpler at first, but we lose pricing leverage and can't fail over.

## Consequences
- A small adapter has to be maintained for each provider.
- Model choice is based on measured evals, not assumptions.
