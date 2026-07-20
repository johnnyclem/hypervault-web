/**
 * Refinement Protocol — Pillar 4 of smallchat 0.4.0.
 *
 * `forwardInvocation:` — when confidence is NONE (< 0.60), turn dispatch
 * into a dialogue. Ask a structured question to narrow the intent until
 * resolution succeeds.
 *
 * Surfaces as a `tool_refinement_needed` result type in MCP.
 */

import type { ToolResult, ToolRefinementNeeded, SelectorMatch } from '../core/types';
import type { LLMClient, RefinementOption, ToolSummary } from '../core/llm-client';

// ---------------------------------------------------------------------------
// Refinement result
// ---------------------------------------------------------------------------

export interface RefinementResult {
  /** Whether the runtime produced refinement options */
  refined: boolean;
  /** The structured refinement to present to the caller */
  refinement?: ToolRefinementNeeded;
}

// ---------------------------------------------------------------------------
// Refinement engine
// ---------------------------------------------------------------------------

/**
 * Generate refinement options for an unresolvable intent.
 *
 * Two strategies, from cheapest to most expensive:
 *   1. Heuristic: build options from nearest vector matches
 *   2. LLM-powered: ask the LLM to suggest rewrites
 */
export async function refine(
  intent: string,
  nearestMatches: SelectorMatch[],
  availableTools: ToolSummary[],
  llmClient?: LLMClient,
): Promise<RefinementResult> {
  // Try LLM-powered refinement first (if available)
  if (llmClient?.refine) {
    const response = await llmClient.refine({
      intent,
      nearestTools: availableTools.slice(0, 10),
    });

    if (response.options.length > 0) {
      return {
        refined: true,
        refinement: {
          type: 'tool_refinement_needed',
          originalIntent: intent,
          question: response.question,
          options: response.options,
          narrowedIntents: response.narrowedIntents,
        },
      };
    }
  }

  // Fallback: heuristic refinement from nearest vector matches
  if (nearestMatches.length > 0) {
    const options = nearestMatches.slice(0, 5).map(match => ({
      label: formatSelectorLabel(match.id),
      // The re-dispatchable intent is the tool's plain-language name, NOT the
      // raw canonical id. Canonicals key on the provider (often an opaque uuid),
      // and feeding "<uuid>.list_tasks" back through the embedder scores even
      // worse than the original intent — the refinement loop that never
      // converges. Keep the intent human, and carry the canonical separately so
      // a caller that trusts the pick can dispatch the exact tool by id.
      intent: humanizeSelector(match.id),
      confidence: 1 - match.distance,
      canonical: match.id,
    }));

    return {
      refined: true,
      refinement: {
        type: 'tool_refinement_needed',
        originalIntent: intent,
        question: `I couldn't find an exact match for "${intent}". Did you mean one of these?`,
        options,
        narrowedIntents: options.map(o => o.intent),
      },
    };
  }

  return { refined: false };
}

/**
 * Build a ToolResult wrapping a refinement response.
 * MCP-aware clients see the `refinement` field; others see a helpful message.
 */
export function buildRefinementResult(refinement: ToolRefinementNeeded): ToolResult {
  return {
    content: {
      message: refinement.question,
      options: refinement.options.map(o => o.label),
      hint: 'Re-dispatch with one of the suggested intents for a more precise match.',
    },
    isError: false,
    refinement,
    metadata: {
      refinement: true,
      optionCount: refinement.options.length,
    },
  };
}

/** The tool portion of a canonical selector id, dropping the provider prefix. */
function toolPartOf(selectorId: string): string {
  const parts = selectorId.split('.');
  return parts[parts.length - 1] ?? selectorId;
}

/**
 * Format a selector ID into a human-readable label. The provider prefix is
 * deliberately dropped: it is frequently an opaque uuid ("List Tasks
 * (77505f39-…)"), which reads as noise to a user choosing between options.
 */
function formatSelectorLabel(selectorId: string): string {
  // "vendor.github.search_code" → "Search Code"; "<uuid>.list_tasks" → "List Tasks"
  return toolPartOf(selectorId)
    .replace(/[_:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** A re-dispatchable, embedder-friendly phrase for a selector — no provider id. */
function humanizeSelector(selectorId: string): string {
  return toolPartOf(selectorId).replace(/[_:]/g, ' ').replace(/\s+/g, ' ').trim();
}
