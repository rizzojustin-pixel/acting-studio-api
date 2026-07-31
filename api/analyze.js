// Acting Studio — AI Director backend (OpenAI, video frames + audio transcript)
// Two-step: 1) transcribe audio via Whisper, 2) score performance with GPT-4o vision.
// The persona, honesty rules, and JSON contract live in ./lib/director.js so
// they can be locked down by tests. Env var required: OPENAI_API_KEY
import {
  capFrames,
  hasEnoughFrames,
  insufficientFramesResponse,
  audioContext,
  buildSystemPrompt,
  buildUserText,
  parseModelJson,
} from "./_director.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const {
    script = "",
    intent = "",
    adjustment = "",
    frames = [],
    scriptMode = "bottom",
    audio = "",
  } = req.body || {};

  const capped = capFrames(frames);

  if (!hasEnoughFrames(frames)) {
    return res.status(200).json(insufficientFramesResponse());
  }

  // ---- STEP 1: transcribe audio (if provided) ----
  let transcript = "";
  let heardAudio = false;
  if (audio && audio.length > 100) {
    try {
      const audioBuffer = Buffer.from(audio, "base64");
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: "audio/m4a" });
      form.append("file", blob, "take.m4a");
      form.append("model", "whisper-1");
      const wr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
        body: form,
      });
      const wdata = await wr.json();
      if (wdata && wdata.text) {
        transcript = wdata.text.trim();
        heardAudio = transcript.length > 0;
      }
    } catch (e) {
      heardAudio = false;
    }
  }

  // Voice guidance signals whether pacing/diction may be scored (see director.js).
  audioContext(heardAudio, transcript);

  const systemPrompt = buildSystemPrompt({ heardAudio, transcript, scriptMode });

  const content = [
    { type: "text", text: buildUserText({ script, intent, adjustment, heardAudio }) },
  ];
  for (const f of capped) {
    content.push({ type: "image_url", image_url: { url: "data:image/jpeg;base64," + f } });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
      }),
    });

    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = (data.choices && data.choices[0] && data.choices[0].message.content) || "";
    const parsed = parseModelJson(text);
    parsed.heardAudio = heardAudio;
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Analysis failed", detail: String(e) });
  }
}
