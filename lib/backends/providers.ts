
export type WireProtocol = "openai" | "anthropic" | "gemini";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "xai"
  | "gemini"
  | "mistral"
  | "ollama"
  | "lmstudio"
  | "custom"
  | "custom-anthropic";

export type ProviderSpec = {
  id: ProviderId;
  label: string;
  protocol: WireProtocol;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  optionalKey?: boolean;
  defaultEmbeddingModel?: string;
};

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    requiresKey: true,
    defaultEmbeddingModel: "text-embedding-3-small",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    protocol: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-opus-4-8",
    requiresKey: true,
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    protocol: "openai",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    requiresKey: true,
  },
  gemini: {
    id: "gemini",
    label: "Google (Gemini)",
    protocol: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-2.5-pro",
    requiresKey: true,
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    protocol: "openai",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    requiresKey: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    protocol: "openai",
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.3",
    requiresKey: false,
  },
  lmstudio: {
    id: "lmstudio",
    label: "LM Studio (local)",
    protocol: "openai",
    defaultBaseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
    requiresKey: false,
  },
  custom: {
    id: "custom",
    label: "Custom endpoint (OpenAI-compatible)",
    protocol: "openai",
    defaultBaseUrl: "",
    defaultModel: "",
    requiresKey: false,
    optionalKey: true,
  },
  "custom-anthropic": {
    id: "custom-anthropic",
    label: "Custom endpoint (Anthropic-compatible)",
    protocol: "anthropic",
    defaultBaseUrl: "",
    defaultModel: "",
    requiresKey: false,
    optionalKey: true,
  },
};

export function providerSpec(id: string): ProviderSpec | null {
  return (PROVIDERS as Record<string, ProviderSpec>)[id] ?? null;
}

export function isProviderId(id: string): id is ProviderId {
  return id in PROVIDERS;
}

export function isCustomProvider(id: string): boolean {
  return id === "custom" || id === "custom-anthropic";
}
