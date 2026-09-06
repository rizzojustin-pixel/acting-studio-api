// The Director's Room — text-to-speech endpoint.
// Reads a director's note aloud in a warm, natural voice. Keys stay server-side.
// Env var required: OPENAI_API_KEY
//
// POST { text: string, voice: "male" | "female" }
// -> { audio: "<base64 mp3>" }  (play on the client)

// Map the app's simple male/female choice to warm OpenAI voices.
const VOICES = { male: "onyx", female: "nova" };
const MAX_CHARS = 3500; // OpenAI TTS input cap is ~4096; stay safely under.

// The soul of the app: HOW the director's note is delivered. gpt-4o-mini-tts
// takes tone instructions, so we steer it to a warm, intimate, believing
// mentor — not an announcer. This is the single biggest lever on the "chills"
// moment; tune it here.
const DIRECTOR_TONE =
  "Speak as a warm, seasoned film director leaning in to an actor between takes: intimate, unhurried, and quietly moved by their work. Believing and kind, a mentor who is on their side — never clinical, never an announcer. Let genuine praise land softly and warmly; before the honest note, take a small breath so it carries weight. Conversational and human, a touch of lived-in gravel, cinematic and close, at a calm and natural pace — the voice you would trust in the last moment before 'action.'";

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
        model: "gpt-4o-mini-tts",
        voice: openaiVoice,
        input: clean,
        instructions: DIRECTOR_TONE,
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
