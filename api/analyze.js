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

// Fetching Cloudinary's extracted audio + Whisper + the GPT-4o vision call can
// take 20-40s; give the function room (Hobby allows up to 300s).
export const config = { maxDuration: 60 };

/**
 * Transcribe an audio Buffer via Whisper. Returns the trimmed transcript, or ""
 * when nothing usable was heard. Never throws — a failed transcription just
 * means Pacing/Diction come back "not assessed".
 */
async function transcribe(buffer, filename, contentType) {
  if (!buffer || buffer.length < 1000) return "";
  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: contentType }), filename);
    form.append("model", "whisper-1");
    const wr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
      body: form,
    });
    const wdata = await wr.json();
    return wdata && wdata.text ? wdata.text.trim() : "";
  } catch (e) {
    console.warn("[analyze] transcription failed", e?.message || e);
    return "";
  }
}

/**
 * Pull the voice out of an uploaded take by fetching Cloudinary's on-the-fly
 * audio extraction (video/upload/<id>.mp3 → Cloudinary transcodes to mp3). The
 * first request may 423 while it processes, so retry briefly. Returns an mp3
 * Buffer or null. Zero dependencies — plain fetch.
 */
async function fetchCloudinaryAudio(cloudId) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "di4i9twd9";
  if (!cloudName || !cloudId) return null;
  // Plain .mp3 on a video asset → Cloudinary extracts the audio as mp3. Keep it
  // transform-free for reliability; Whisper downsamples internally anyway.
  const url = `https://res.cloudinary.com/${cloudName}/video/upload/${cloudId}.mp3`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      // 423 = still processing; anything else transient → wait and retry.
      if (r.status !== 423 && r.status !== 420 && r.status < 500) {
        console.warn("[analyze] cloudinary audio fetch", r.status);
        return null;
      }
    } catch (e) {
      console.warn("[analyze] cloudinary fetch error", e?.message || e);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

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
    cloudId = "",
    actorName = "",
    profile = "",
    purpose = "",
    sceneHistory = null,
  } = req.body || {};

  const capped = capFrames(frames);

  if (!hasEnoughFrames(frames)) {
    return res.status(200).json(insufficientFramesResponse());
  }

  // ---- STEP 1: get the voice track and transcribe it ----
  // Preferred path: the app uploaded the un-muted video to Cloudinary and passed
  // its public id; we fetch Cloudinary's on-the-fly audio extraction. Legacy
  // path: a base64 m4a in the request body. Transcription failing is non-fatal
  // (Pacing and Diction just come back "not assessed").
  let transcript = "";
  let heardAudio = false;
  if (cloudId) {
    const mp3 = await fetchCloudinaryAudio(cloudId);
    if (mp3) {
      transcript = await transcribe(mp3, "audio.mp3", "audio/mpeg");
      heardAudio = transcript.length > 0;
    }
  } else if (audio && audio.length > 100) {
    const buf = Buffer.from(audio, "base64");
    transcript = await transcribe(buf, "take.m4a", "audio/m4a");
    heardAudio = transcript.length > 0;
  }

  // Voice guidance signals whether pacing/diction may be scored (see director.js).
  audioContext(heardAudio, transcript);

  const systemPrompt = buildSystemPrompt({ heardAudio, transcript, scriptMode });

  const content = [
    {
      type: "text",
      text: buildUserText({
        script,
        intent,
        adjustment,
        heardAudio,
        actorName,
        profile,
        purpose,
        sceneHistory,
      }),
    },
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
