/**
 * short-hand
 *
 * Progressive context compaction for LLMs.
 * Old computer science for new constraints.
 */

// Core types
export type {
  ConversationMessage,
  MessageRole,
  CompactedState,
  CompactionLevel,
  CompactionConfig,
  Compactor,
  CompactorTier,
  ContextFrame,
  ContextSection,
  Tombstone,
  Entity,
  EntityType,
  Edge,
  EdgeRelation,
  KnowledgeGraph,
  Decision,
  TopicSummary,
  Invariant,
  ImportanceScore,
  ImportanceWeights,
  VerificationResult,
  AgentProfile,
  Source,
  IngestionConfig,
  IngestionEvent,
  WikiPage,
  WikiRenderConfig,
  ActiveEngram,
  ActivationPolicy,
  ActiveEngramResult,
} from './types';

export {
  CompactionLevel as CompactionLevelEnum,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_IMPORTANCE_WEIGHTS,
  DEFAULT_INGESTION_CONFIG,
  DEFAULT_WIKI_RENDER_CONFIG,
} from './types';

// Compaction engine
export { CompactionEngine } from './compaction/compaction-engine';
export { RegexCompactor } from './compaction/regex-compactor';

// Importance detection
export { ImportanceDetector } from './importance/importance-detector';

// CRDT primitives
export { LWWRegister } from './crdt/lww-register';
export { ORSet } from './crdt/or-set';
export { GSet } from './crdt/g-set';
export { AgentMemory } from './crdt/agent-memory';
export type { SerializedAgentMemory } from './crdt/agent-memory';
export { ActiveEngramStore } from './crdt/active-engram-store';
export type {
  SerializedActiveEngramStore,
  ActiveEngramStoreOptions,
} from './crdt/active-engram-store';

// Interpreter (bounded LM step at retrieval time)
export type {
  Interpreter,
  InterpreterTier,
  InterpretInput,
  InterpretOptions,
  InterpreterLogger,
  InterpreterBudgetReason,
} from './interpreter/index';
export {
  InterpreterBudgetError,
  InterpreterUnavailableError,
  silentLogger,
  isFallbackEligible,
  RegexInterpreter,
  resolveTemplate,
  HostInterpreter,
  LocalInterpreter,
  withFallback,
} from './interpreter/index';
export type {
  HostInterpreterOptions,
  AnthropicLikeClient,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  LocalInterpreterOptions,
  WithFallbackOptions,
} from './interpreter/index';

// Context-shift benchmark
export {
  ContextShiftBenchmark,
  echoAnswerer,
  wilson95,
  KeywordJudge,
  LMJudge,
  STARTER_FIXTURES,
} from './benchmark/index';
export type {
  BenchmarkFixture,
  ShiftType,
  ArmResult,
  FixtureResult,
  BenchmarkAggregate,
  BenchmarkReport,
  Answerer,
  AnswererArgs,
  ContextShiftBenchmarkOptions,
  RunOptions,
  Judge,
  JudgeArgs,
  LMJudgeOptions,
} from './benchmark/index';

// Verification
export { InvariantChecker } from './verification/invariant-checker';
export { RecallTester } from './verification/recall-tester';

// Embedding (stub)
export { StubEmbedder } from './embedding/index';
export type { Embedder, EmbeddingResult } from './embedding/index';

// Source ingestion
export { SourceIngester } from './ingestion/source-ingester';

// Wiki rendering
export { WikiRenderer } from './wiki/wiki-renderer';

// Utilities
export { estimateTokens, generateId } from './utils';
