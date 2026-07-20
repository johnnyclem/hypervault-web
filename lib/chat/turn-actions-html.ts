
import { CHAT_TRANSCRIPT_MARKER } from "@/lib/chat/share";

const CHAT_TAGS = new Set(["chat", "memories"]);

export function isChatArtifact(tags: unknown): boolean {
  return Array.isArray(tags) && tags.some((t) => typeof t === "string" && CHAT_TAGS.has(t));
}

export function isChatTranscriptHtml(html: string): boolean {
  if (typeof html !== "string") return false;
  if (html.includes(`name="${CHAT_TRANSCRIPT_MARKER}"`)) return true;
  return /<article[\s>]/i.test(html) && html.includes("white-space: pre-wrap");
}

export function shouldShowTurnActionsBar(artifact: {
  tags: unknown;
  is_jsx?: boolean | null;
  content: string;
}): boolean {
  if (!isChatArtifact(artifact.tags)) return false;
  if (artifact.is_jsx) return false;
  return isChatTranscriptHtml(artifact.content);
}

const BAR_ID = "hv-turn-actions";

export function hasTurnActionsBar(html: string): boolean {
  return html.includes(`id="${BAR_ID}"`);
}

function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  share:
    '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
  thumbsUp:
    '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  thumbsDown:
    '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  speak:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  stop: '<rect width="12" height="12" x="6" y="6" rx="1" fill="currentColor"/>',
};

function icon(name: keyof typeof ICONS, size = 15): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
  );
}

function button(action: string, label: string, iconName: keyof typeof ICONS): string {
  return (
    `<button type="button" data-hv-action="${action}" aria-label="${label}" title="${label}">` +
    icon(iconName) +
    `</button>`
  );
}

export function turnActionsBarHtml(meta: { slug: string; title: string }): string {
  return `
<style>
#${BAR_ID}{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:2px;
  max-width:calc(100vw - 24px);padding:5px 8px;border-radius:999px;border:1px solid rgba(128,128,136,.35);
  background:rgba(250,250,250,.9);color:#52525b;box-shadow:0 4px 16px rgba(0,0,0,.14);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  font-family:ui-sans-serif,system-ui,sans-serif;z-index:2147483647}
#${BAR_ID} button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;
  padding:0;border:0;border-radius:8px;background:none;color:inherit;cursor:pointer}
#${BAR_ID} button:hover{background:rgba(128,128,136,.18);color:inherit}
#${BAR_ID} button[aria-pressed="true"][data-hv-action="up"]{color:#0891b2}
#${BAR_ID} button[aria-pressed="true"][data-hv-action="down"]{color:#dc2626}
#${BAR_ID} .hv-ta-msg{font-size:11px;line-height:1.2;margin:0 4px;max-width:44vw;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
#${BAR_ID} .hv-ta-msg:empty{display:none}
@media (prefers-color-scheme: dark){
  #${BAR_ID}{background:rgba(24,24,27,.9);color:#a1a1aa;border-color:rgba(128,128,136,.45)}
  #${BAR_ID} button[aria-pressed="true"][data-hv-action="up"]{color:#22d3ee}
  #${BAR_ID} button[aria-pressed="true"][data-hv-action="down"]{color:#f87171}
}
</style>
<div id="${BAR_ID}" role="toolbar" aria-label="Reply actions">
${button("copy", "Copy reply", "copy")}
${button("share", "Share reply", "share")}
${button("up", "Good reply", "thumbsUp")}
${button("down", "Bad reply", "thumbsDown")}
${button("speak", "Read aloud", "speak")}
<span class="hv-ta-msg" role="status"></span>
</div>
<script>
(function () {
  var SLUG = ${jsString(meta.slug)};
  var TITLE = ${jsString(meta.title)};
  var API = "/api/artifacts/" + encodeURIComponent(SLUG) + "/feedback";
  var bar = document.getElementById("${BAR_ID}");
  if (!bar) return;
  var msg = bar.querySelector(".hv-ta-msg");
  var btn = {};
  bar.querySelectorAll("[data-hv-action]").forEach(function (b) { btn[b.getAttribute("data-hv-action")] = b; });
  var icons = {
    copy: ${jsString(icon("copy"))},
    check: ${jsString(icon("check"))},
    speak: ${jsString(icon("speak"))},
    stop: ${jsString(icon("stop"))}
  };

  var pad = window.getComputedStyle(document.body).paddingBottom;
  document.body.style.paddingBottom = "calc(" + (pad || "0px") + " + 64px)";

  var msgTimer = null;
  function say(text) {
    msg.textContent = text || "";
    clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { msg.textContent = ""; }, 4000);
  }

  function pageText() {
    var article = document.querySelector("article");
    if (article) return article.innerText.trim();
    bar.hidden = true;
    var text = document.body.innerText.trim();
    bar.hidden = false;
    return text;
  }

  btn.copy.addEventListener("click", function () {
    navigator.clipboard.writeText(pageText()).then(function () {
      btn.copy.innerHTML = icons.check;
      setTimeout(function () { btn.copy.innerHTML = icons.copy; }, 2000);
    }, function () {
      say("Couldn't reach the clipboard — select the text to copy it.");
    });
  });

  btn.share.addEventListener("click", function () {
    if (navigator.share) {
      navigator.share({ title: TITLE, url: location.href }).catch(function () {});
    } else {
      navigator.clipboard.writeText(location.href).then(function () {
        say("Link copied.");
      }, function () {
        say("Copy the link from the address bar to share it.");
      });
    }
  });

  var feedback = null;
  function paintThumbs() {
    btn.up.setAttribute("aria-pressed", feedback === "up" ? "true" : "false");
    btn.down.setAttribute("aria-pressed", feedback === "down" ? "true" : "false");
  }
  paintThumbs();
  fetch(API, { credentials: "same-origin" }).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (data && (data.feedback === "up" || data.feedback === "down")) {
      feedback = data.feedback;
      paintThumbs();
    }
  }).catch(function () {});

  function rate(next) {
    var value = feedback === next ? null : next; // tapping again clears
    var previous = feedback;
    feedback = value;
    paintThumbs();
    fetch(API, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: value })
    }).then(function (res) {
      if (res.ok) return null;
      return res.json().catch(function () { return {}; }).then(function (data) {
        feedback = previous;
        paintThumbs();
        say(res.status === 401
          ? "Sign in to your vault to rate this reply."
          : (data && data.error) || "Couldn't save your rating — try again.");
      });
    }).catch(function () {
      feedback = previous;
      paintThumbs();
      say("Network hiccup — your rating wasn't saved, try again.");
    });
  }
  btn.up.addEventListener("click", function () { rate("up"); });
  btn.down.addEventListener("click", function () { rate("down"); });

  var speaking = false;
  btn.speak.addEventListener("click", function () {
    var synth = window.speechSynthesis;
    if (!synth) {
      say("Read-aloud isn't available in this browser.");
      return;
    }
    if (speaking) {
      synth.cancel();
      return; // onend/onerror restores the button
    }
    var utterance = new SpeechSynthesisUtterance(pageText());
    var done = function () {
      speaking = false;
      btn.speak.innerHTML = icons.speak;
      btn.speak.setAttribute("aria-label", "Read aloud");
      btn.speak.setAttribute("title", "Read aloud");
    };
    utterance.onend = done;
    utterance.onerror = done;
    speaking = true;
    btn.speak.innerHTML = icons.stop;
    btn.speak.setAttribute("aria-label", "Stop reading");
    btn.speak.setAttribute("title", "Stop reading");
    synth.cancel();
    synth.speak(utterance);
  });
})();
</script>
`;
}

export function injectTurnActionsBar(html: string, meta: { slug: string; title: string }): string {
  if (hasTurnActionsBar(html)) return html;
  const block = turnActionsBarHtml(meta);
  const closing = html.match(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  if (closing && closing.index !== undefined) {
    return html.slice(0, closing.index) + block + html.slice(closing.index);
  }
  return html + block;
}
