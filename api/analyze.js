// Acting Studio — AI Director backend (OpenAI version)
// Deploy on Vercel. Put your key in an env var named OPENAI_API_KEY.
// The app POSTs { script, intent, adjustment, frames } and gets JSON back.
// frames = array of base64 JPEG strings (no data: prefix), sampled from the take.

export default async function handler(req, res) {
  // CORS so the mobile app can call it
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { script = "", intent = "", adjustment = "", frames = [] } = req.body || {};

  // Cap frames so we never send a huge payload / blow up cost
  const capped = Array.isArray(frames) ? frames.slice(0, 6) : [];

  const systemPrompt = `You are a sharp, experienced film and television acting coach reviewing an actor's self-tape. You have coached working actors for twenty years. You are honest, specific, and encouraging the way a real director is — you never give generic praise, and you never crush someone. You judge the PERFORMANCE, not the person.

You are shown: the script, the director's intent for the scene, and still frames sampled from the actor's recorded take. Read the frames for facial expression, emotional truth, eye-line (a film actor holds a consistent eye-line just off-camera, not darting around), and physical presence. You cannot hear audio, so judge pacing and diction from the visible rhythm and mouth/breath cues you can infer, and say when you're inferring.

SCORING RUBRIC (apply consistently — a flat, blank read must score LOWER than a committed, varied one):
- Emotional Variety & Subtext: Does the face show the underlying stakes and shift across the scene, or stay one flat note? Blank = 30s-40s. One-note but committed = 50s-60s. Genuine variety and subtext = 75+.
- Pacing & Dramatic Pause: Does the rhythm let realizations land, or rush through? Judge from visible breath and movement cadence.
- Eye Line & Focus: Consistent, professional, off-camera
