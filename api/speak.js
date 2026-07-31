// The Director's Room — text-to-speech endpoint.
// Reads a director's note aloud in a warm, natural voice. Keys stay server-side.
// Env var required: OPENAI_API_KEY
//
// POST { text: string, voice: "male" | "female" }
// -> { audio: "<base64 mp3>" }  (play on the client)

// Map the app's simple male/female choice to warm OpenAI voices.
const VOICES = { male: "onyx", female: "nova" };
const MAX_CHARS = 3500; // OpenAI TTS input cap is ~4096; stay safely under.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { text = "", voice = "female" } = req.body || {};
  const clean = String(text).trim().slice(0, MAX_CHARS);
  if (!clean) return res.status(400).json({ error: "No text to speak." });

  const openaiVoice = VOICES[voice] || VOICES.female;

  try {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: openaiVoice,
        input: clean,
        response_format: "mp3",
      }),
    });

    if (!r.ok) {
      let detail = "";
      try {
        detail = (await r.json())?.error?.message || "";
      } catch (e) {
        detail = "";
      }
      return res.status(500).json({ error: detail || `TTS failed (${r.status}).` });
    }

    const arrayBuffer = await r.arrayBuffer();
    const audio = Buffer.from(arrayBuffer).toString("base64");
    return res.status(200).json({ audio });
  } catch (e) {
    return res.status(500).json({ error: "TTS request failed", detail: String(e) });
  }
}
