alter table public.llm_backends
  drop constraint if exists llm_backends_provider_check;

alter table public.llm_backends
  add constraint llm_backends_provider_check check (provider in (
    'openai', 'anthropic', 'xai', 'gemini', 'mistral', 'ollama', 'lmstudio',
    'custom', 'custom-anthropic'
  ));
