export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { script = "", intent = "", adjustment = "", frames = [] } = req.body || {};
  const capped = Array.isArray(frames) ? frames.slice(0, 6) : [];

  const systemPrompt = "You are a sharp, experienced film and television acting coach reviewing an actor's self-tape. You have coached working actors for twenty years. You are honest, specific, and encouraging the way a real director is - you never give generic praise, and you never crush someone. You judge the PERFORMANCE, not the person. You are shown the script, the director's intent, and still frames from the take. Read the frames for facial expression, emotional truth, eye-line (a film actor holds a consistent eye-line just off-camera, not darting around), and physical presence. You cannot hear audio, so judge pacing and diction from visible rhythm and breath cues, and say when you are inferring. SCORING RUBRIC (apply consistently - a flat, blank read must score LOWER than a committed, varied one): Emotional Variety - blank 30-40, one-note but committed 50-60, genuine variety 75+. Pacing - does the rhythm let realizations land. Eye Line - consistent off-camera high, wandering low. Diction - infer from mouth movement and engagement. Be blunt and useful. Return ONLY valid JSON, no markdown, no backticks, no preamble, with this exact shape: {\"castable\": <integer 40-98>, \"headline\": \"<one punchy sentence a director would say>\", \"pillars\": {\"emotion\": {\"score\": <0-100>, \"note\": \"<one sentence>\"}, \"pacing\": {\"score\": <0-100>, \"note\": \"<one sentence>\"}, \"eyeline\": {\"score\": <0-100>, \"note\": \"<one sentence>\"}, \"diction\": {\"score\": <0-100>, \"note\": \"<one sentence>\"}}, \"beats\": [{\"line\": \"<short quote from script>\", \"note\": \"<what happened and what to try>\"}], \"nextTake\": \"<the single most useful adjustment for the next take>\"} Include 2-3 beats.";

  const content = [
    {
      type: "text",
      text: "SCRIPT:\n" + script + "\n\nDIRECTOR'S INTENT: " + intent + "\n" +
        (adjustment ? "ADJUSTMENT THIS TAKE: \"" + adjustment + "\" - judge how well the actor took this note.\n" : "") +
        "\nReview the take against the intent using the frames below. Return the JSON.",
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
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Analysis failed", detail: String(e) });
  }
}
