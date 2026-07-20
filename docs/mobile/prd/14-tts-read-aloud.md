# M14 — Read Replies Aloud (TTS)

**Status:** Draft · **Epic:** M14 · **Depends:** M8 (speaker button lives in the chat turn action row)

## Goal

Give every assistant reply in chat a speaker button that reads it aloud, the
native equivalent of the web's on-device `pocket-tts` (spec §9). **v1 uses the
platform's on-device TTS** — iOS `AVSpeechSynthesizer`, Android `TextToSpeech`
— so it works immediately with no download and no network. An **optional
fast-follow** ships bundled neural TTS (pocket-tts running in the WebLLM
webview from M9) for voice parity with the web, behind the same
"download-once, cache offline" UX. The button follows the web state machine —
idle / loading / generating / playing, tap-to-stop — and audio stops on
unmount and navigation.

## User stories

- As a user, I can tap a speaker button on any assistant reply and hear it read
  aloud.
- As a user, I can tap again to stop playback (or cancel a load/generation).
- As a user, audio stops when I leave the conversation or the app backgrounds —
  it never keeps playing from a screen I've left.
- As a user, TTS works offline with the platform voice out of the box.
- As a user (fast-follow), I can opt into a higher-quality bundled voice that
  downloads once and then works offline.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M14-01 | Platform TTS engine wrapper | 2 | T-M1-01 | A `SpeechEngine` module over iOS `AVSpeechSynthesizer` / Android `TextToSpeech` (via `expo-speech` or a thin native module), exposing `speak(text, {onStateChange})` and `stop()`. Emit the web state machine: `idle` / `loading` / `generating` / `playing` / `idle{error?}`. Platform TTS has no download, so `loading`/`generating` collapse to a brief `generating` before `playing`. Acceptance: calling `speak` transitions to playing and fires an end callback back to idle; `stop()` halts immediately; errors surface as `idle` with an error. |
| T-M14-02 | Speaker button in the turn action row | 2 | T-M14-01, T-M8 | Per-assistant-reply speaker button in the M8 action row. Icon reflects state: Volume2 (idle) → spinner (loading/generating) → Square/stop (playing). Tap when idle → speak; tap when busy → stop/cancel. Inline micro-status text for loading (with %, neural path) / generating. Accessible label flips between "Read aloud" / "Stop reading" / "Cancel"; 44pt target. Acceptance: tapping reads the reply; the icon and label track state; tapping again stops; errors show a short inline message. |
| T-M14-03 | Stop on unmount, navigation, and background | 1 | T-M14-02 | Cut audio when the thread unmounts (switching conversations), on navigation away, and when the app backgrounds — mirror the web's unmount cleanup. Only one reply plays at a time; starting a new one stops the previous. Acceptance: leaving the conversation or backgrounding the app stops playback; starting reply B stops reply A. |
| T-M14-04 | Single-active-playback coordination | 1 | T-M14-02 | A small shared controller so at most one `SpeakButton` is non-idle app-wide; a new speak stops any other. Prevents overlapping audio across turns/screens. Acceptance: with two replies, playing the second stops the first and resets its button to idle. |
| T-M14-05 | (Fast-follow) Bundled neural TTS in the WebLLM webview | 2 | T-M14-01, T-M9 | Optional pocket-tts path hosted in the M9 WebLLM `react-native-webview`: RN posts text, the webview synthesizes and streams audio back; RN plays it. Selected via a Settings toggle; falls back to platform TTS when unavailable. Reuses the M9 webview bridge (`postMessage`). Acceptance: with the neural voice enabled, replies read in the pocket-tts voice; disabling or a webview failure falls back to platform TTS with no user-visible break. |
| T-M14-06 | (Fast-follow) Download-once + cache UX for the neural model | 1 | T-M14-05 | First use of the neural voice downloads the model with inline progress ("Downloading voice model… N%"), caches it offline (mirror the M9 model-cache pattern), and reuses it thereafter. Cancelling the download returns to idle. Acceptance: first tap shows download progress and then plays; subsequent taps skip the download; the cached model works offline; cancel is clean. |

## Out of scope / notes

- **v1 is platform TTS** (no download, offline, immediate). The neural pocket-tts
  path (T-M14-05/06) is an explicitly optional fast-follow for web-voice parity
  and depends on the M9 webview — do not block M14 shipping on it.
- Reuse the M9 WebLLM webview for the neural path rather than standing up a
  second webview; the bridge and model-cache UX are shared.
- Long replies: chunk to the engine as needed so `stop()` is responsive; never
  hold the UI while synthesizing.
