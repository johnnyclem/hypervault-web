
import { concatFloat32, downloadPercent, prepareSpeechText } from "./audio";

export type SpeakState =
  | { state: "loading"; percent: number | null }
  | { state: "generating" }
  | { state: "playing" }
  | { state: "idle"; error?: string };

export type SpeakHandle = { stop: () => void };

type Engine = {
  tts: import("pocket-tts-js").PocketTTS;
  voice: string;
  sampleRate: number;
};

type Clip = { data: Float32Array; sampleRate: number };

const EXPECTED_DOWNLOAD_BYTES: Record<string, number> = {
  tokenizer: 60_000,
  text_conditioner: 16_400_000,
  flow_lm_main: 76_300_000,
  flow_lm_flow: 10_000_000,
  mimi_decoder: 22_700_000,
  voices: 52_400_000,
};

let enginePromise: Promise<Engine> | null = null;
let audioCtx: AudioContext | null = null;
let current: SpeakHandle | null = null;
let generateChain: Promise<unknown> = Promise.resolve();

const downloadListeners = new Set<(percent: number) => void>();
const fileProgress = new Map<string, { loaded: number; total: number }>();

const clipCache = new Map<string, Clip>();
const CLIP_CACHE_MAX = 16;
const CLIP_CACHE_MAX_SAMPLES = 24_000 * 600;

function rememberClip(text: string, clip: Clip) {
  if (clip.data.length > CLIP_CACHE_MAX_SAMPLES) return;
  clipCache.delete(text);
  clipCache.set(text, clip);
  let samples = 0;
  for (const c of clipCache.values()) samples += c.data.length;
  while (clipCache.size > CLIP_CACHE_MAX || samples > CLIP_CACHE_MAX_SAMPLES) {
    const oldest = clipCache.keys().next().value;
    if (oldest === undefined) break;
    samples -= clipCache.get(oldest)?.data.length ?? 0;
    clipCache.delete(oldest);
  }
}

type WorkerInternals = {
  worker: Worker | null;
  _pending: Map<number, { reject: (err: Error) => void }>;
  _handleMessage: (data: unknown) => void;
  _ensureWorker: () => void;
};

function useSameOriginWorker(tts: Engine["tts"]) {
  const internals = tts as unknown as WorkerInternals;
  internals._ensureWorker = () => {
    if (internals.worker) return;
    internals.worker = new Worker("/pocket-tts-worker.js", { type: "module" });
    internals.worker.onmessage = (e) => internals._handleMessage(e.data);
    internals.worker.onerror = (e) => {
      const err = new Error(e.message || "Worker error");
      for (const { reject } of internals._pending.values()) reject(err);
      internals._pending.clear();
    };
  };
}

async function loadEngine(): Promise<Engine> {
  const { PocketTTS } = await import("pocket-tts-js");
  const tts = new PocketTTS({
    quantized: true,
    voiceCloning: false,
  });
  useSameOriginWorker(tts);
  fileProgress.clear();
  let lastPercent = 0;
  const bundle = await tts.load((p) => {
    if (p.type !== "progress" || !p.label || !p.total) return;
    fileProgress.set(p.label, { loaded: p.loaded ?? 0, total: p.total });
    lastPercent = Math.max(lastPercent, downloadPercent(fileProgress, EXPECTED_DOWNLOAD_BYTES));
    for (const listener of downloadListeners) listener(lastPercent);
  });
  const voices = bundle?.predefinedVoices ?? tts.predefinedVoices ?? [];
  const name = voices.includes("alba") ? "alba" : voices[0];
  if (!name) throw new Error("The voice bundle has no built-in voices.");
  const voice = await tts.loadVoice(name);
  return { tts, voice, sampleRate: tts.sampleRate };
}

function ensureEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = loadEngine().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

const PRIME_SECONDS = 1;
const LEAD_SECONDS = 0.08;

type ChunkPlayer = {
  enqueue: (data: Float32Array) => void;
  finish: () => Promise<void>;
  stop: () => void;
};

function createChunkPlayer(ctx: AudioContext, sampleRate: number, onStart: () => void): ChunkPlayer {
  const sources = new Set<AudioBufferSourceNode>();
  let last: AudioBufferSourceNode | null = null;
  let nextStart = 0;
  let primed = false;
  let stopped = false;
  let pending: Float32Array[] = [];
  let pendingSeconds = 0;

  function schedule(data: Float32Array) {
    const buffer = ctx.createBuffer(1, data.length, sampleRate);
    buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const at = Math.max(ctx.currentTime, nextStart);
    source.start(at);
    nextStart = at + buffer.duration;
    sources.add(source);
    source.addEventListener("ended", () => sources.delete(source));
    last = source;
  }

  function flush() {
    if (stopped || primed) return;
    primed = true;
    nextStart = ctx.currentTime + LEAD_SECONDS;
    const queued = pending;
    pending = [];
    pendingSeconds = 0;
    for (const chunk of queued) schedule(chunk);
    if (last) onStart();
  }

  return {
    enqueue(data) {
      if (stopped || data.length === 0) return;
      if (primed) {
        schedule(data);
        return;
      }
      pending.push(data);
      pendingSeconds += data.length / sampleRate;
      if (pendingSeconds >= PRIME_SECONDS) flush();
    },
    finish() {
      flush();
      const tail = last;
      if (stopped || !tail || !sources.has(tail)) return Promise.resolve();
      return new Promise((resolve) => tail.addEventListener("ended", () => resolve()));
    },
    stop() {
      stopped = true;
      pending = [];
      for (const source of sources) {
        try {
          source.stop();
        } catch {
        }
      }
      sources.clear();
    },
  };
}

export function speak(rawText: string, notify: (s: SpeakState) => void): SpeakHandle {
  let cancelled = false;
  let generating = false;
  let player: ChunkPlayer | null = null;

  const handle: SpeakHandle = {
    stop() {
      if (cancelled) return;
      cancelled = true;
      if (current === handle) current = null;
      player?.stop();
      if (generating) {
        enginePromise?.then(({ tts }) => tts.stop()).catch(() => {});
      }
      notify({ state: "idle" });
    },
  };

  current?.stop();
  current = handle;

  const run = async () => {
    const text = prepareSpeechText(rawText);
    if (!text) throw new Error("Nothing to read aloud.");

    const onDownload = (percent: number) => {
      if (!cancelled) notify({ state: "loading", percent });
    };
    downloadListeners.add(onDownload);
    notify({ state: "loading", percent: null });
    let engine: Engine;
    try {
      engine = await ensureEngine();
    } finally {
      downloadListeners.delete(onDownload);
    }
    if (cancelled) return;

    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (cancelled) return;

    const cached = clipCache.get(text);
    player = createChunkPlayer(audioCtx, cached?.sampleRate ?? engine.sampleRate, () => {
      if (!cancelled) notify({ state: "playing" });
    });

    if (cached) {
      player.enqueue(cached.data);
    } else {
      notify({ state: "generating" });
      generating = true;
      const chunks: Float32Array[] = [];
      const generation = generateChain.catch(() => {}).then(() => {
        if (cancelled) return null;
        return engine.tts.generate(text, {
          voice: engine.voice,
          onChunk: (audio) => {
            if (cancelled) return;
            chunks.push(audio);
            player?.enqueue(audio);
          },
        });
      });
      generateChain = generation.catch(() => {});
      const metrics = await generation;
      generating = false;
      if (cancelled) return;
      if (!metrics || metrics.stopped) {
        cancelled = true;
        if (current === handle) current = null;
        player.stop();
        notify({ state: "idle" });
        return;
      }
      const data = concatFloat32(chunks);
      if (data.length === 0) throw new Error("The model produced no audio.");
      rememberClip(text, { data, sampleRate: engine.sampleRate });
    }
    if (cancelled) return;

    await player.finish();
    if (cancelled) return;
    cancelled = true;
    if (current === handle) current = null;
    notify({ state: "idle" });
  };

  run().catch((err: unknown) => {
    generating = false;
    player?.stop();
    if (cancelled) return;
    cancelled = true;
    if (current === handle) current = null;
    const message = err instanceof Error ? err.message : "Text-to-speech failed.";
    notify({ state: "idle", error: message });
  });

  return handle;
}
