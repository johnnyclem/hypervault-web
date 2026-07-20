/**
 * Artifact — compiled tool artifact serialization helpers.
 *
 * HyperVault modification: trimmed to the pure-serialization surface.
 * Upstream's loadRuntime/hydrateRuntime/findManifests (node:fs + sqlite
 * paths, hard-coded LocalEmbedder, endpoint-less ToolProxy hydration) are
 * removed — HyperVault hydrates runtimes itself in lib/smallchat/runtime.ts
 * with the correct embedder and live endpoints.
 */

import type { CompilationResult, ProviderManifest, ToolResult } from '../core/types';

// ---------------------------------------------------------------------------
// Serialized artifact shape
// ---------------------------------------------------------------------------

export interface SerializedArtifact {
  version: string;
  stats: {
    toolCount: number;
    uniqueSelectorCount: number;
    providerCount: number;
    collisionCount: number;
  };
  selectors: Record<
    string,
    { canonical: string; parts: string[]; arity: number; vector: number[] }
  >;
  dispatchTables: Record<
    string,
    Record<
      string,
      {
        providerId: string;
        toolName: string;
        transportType: string;
        inputSchema?: Record<string, unknown>;
        compilerHints?: Record<string, unknown>;
      }
    >
  >;
  /** Provider-level compiler hints baked into this artifact */
  providerHints?: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Artifact construction
// ---------------------------------------------------------------------------

export function buildArtifact(
  result: CompilationResult,
  manifests: ProviderManifest[],
): SerializedArtifact {
  const schemaIndex = new Map<string, Record<string, unknown>>();
  const hintIndex = new Map<string, Record<string, unknown>>();
  for (const manifest of manifests) {
    for (const tool of manifest.tools) {
      schemaIndex.set(
        tool.name,
        tool.inputSchema as unknown as Record<string, unknown>,
      );
      if (tool.compilerHints) {
        hintIndex.set(tool.name, tool.compilerHints as unknown as Record<string, unknown>);
      }
    }
  }

  const selectors: SerializedArtifact['selectors'] = {};
  for (const [key, sel] of result.selectors) {
    selectors[key] = {
      canonical: sel.canonical,
      parts: sel.parts,
      arity: sel.arity,
      vector: Array.from(sel.vector),
    };
  }

  const dispatchTables: SerializedArtifact['dispatchTables'] = {};
  for (const [providerId, table] of result.dispatchTables) {
    const methods: Record<
      string,
      {
        providerId: string;
        toolName: string;
        transportType: string;
        inputSchema?: Record<string, unknown>;
        compilerHints?: Record<string, unknown>;
      }
    > = {};
    for (const [canonical, imp] of table) {
      methods[canonical] = {
        providerId: imp.providerId,
        toolName: imp.toolName,
        transportType: imp.transportType,
        inputSchema: schemaIndex.get(imp.toolName),
        compilerHints: hintIndex.get(imp.toolName),
      };
    }
    dispatchTables[providerId] = methods;
  }

  // Collect provider-level hints
  const providerHints: Record<string, Record<string, unknown>> = {};
  for (const manifest of manifests) {
    if (manifest.compilerHints) {
      providerHints[manifest.id] = manifest.compilerHints as unknown as Record<string, unknown>;
    }
  }

  return {
    version: '0.5.0',
    stats: {
      toolCount: result.toolCount,
      uniqueSelectorCount: result.uniqueSelectorCount,
      providerCount: result.dispatchTables.size,
      collisionCount: result.collisions.length,
    },
    selectors,
    dispatchTables,
    ...(Object.keys(providerHints).length > 0 ? { providerHints } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tool list & content helpers
// ---------------------------------------------------------------------------

export function buildToolList(artifact: SerializedArtifact): object[] {
  const tools: object[] = [];
  for (const [_providerId, methods] of Object.entries(
    artifact.dispatchTables,
  )) {
    for (const [canonical, imp] of Object.entries(methods)) {
      const inputSchema = imp.inputSchema ?? {
        type: 'object',
        properties: {},
      };
      tools.push({
        name: imp.toolName,
        description: `${canonical} [${imp.providerId}]`,
        inputSchema,
      });
    }
  }
  return tools;
}

export function formatContent(
  result: ToolResult,
): Array<{ type: string; text: string }> {
  const text =
    typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content);
  return [{ type: 'text', text }];
}
