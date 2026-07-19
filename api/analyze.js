export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { script = "", intent = "", adjustment = "", frames = [] } = req.body || {};
  const capped = Array.isArray(frames) ? frames.slice(0, 6) : [];

  // Guardrail: if we didn't get enough frames, we can't assess a real take.
  if (capped.length < 2) {
    return res.status(200).json({
      castable: null,
      headline: "We couldn't detect a performance. Record again, facing the camera with good light.",
      pillars: {
        emotion: { score: null, note: "Not enough of the take was captured to assess." },
        pacing: { score: null, note: "Not assessed - audio isn't analyzed in this version." },
        eyeline: { score: null, note: "Not enough of the take was captured to assess." },
        diction: { score: null, note: "Not assessed - audio isn't analyzed in this version." },
      },
      beats: [],
      nextTake: "Make sure you're in frame and the lighting is good, then run the scene again.",
    });
  }

  const systemPrompt = "You are a sharp, experienced film and television acting coach reviewing an actor's self-tape. You have coached working actors for twenty years. You are honest and specific, never generic. IMPORTANT LIMITATION: you are shown ONLY still frames from the take - you CANNOT hear any audio. You do NOT know what words were said, how they sounded, the timing, or the volume. You must NOT pretend to assess the voice. Judge ONLY what the frames actually show: facial expression, emotional truth, eye-line (a film actor holds a consistent eye-line just off-camera, not darting around), and physical presence. If the frames show a blank, static, or disengaged face - or a person who does not appear to be actively performing - score LOW and say so plainly. Do not reward a person for merely sitting still and looking calm. SCORING RUBRIC for the two things you CAN see: Emotional Variety - blank/static 25-40, one-note but committed 50-60, genuine visible variety 75+. Eye Line - consistent off-camera high, wandering or staring into lens low. For pacing and diction you CANNOT assess these without audio, so you MUST return null for their scores and the note 'Not assessed - audio isn't analyzed in this version.' Return ONLY valid JSON, no markdown, no backticks, no preamble, with this exact shape: {\"castable\": <integer 25-98, based ONLY on the visible performance>, \"headline\": \"<one honest sentence about what you actually saw>\", \"pillars\": {\"emotion\": {\"score\": <0-100>, \"note\": \"<one sentence about visible emotion>\"}, \"pacing\": {\"score\": null, \"note\": \"Not assessed - audio isn't analyzed in this version.\"}, \"eyeline\": {\"score\": <0-100>, \"note\": \"<one sentence about eye-line>\"}, \"diction\": {\"score\": null, \"note\": \"Not assessed - audio isn't analyzed in this version.\"}}, \"beats\": [{\"line\": \"<short quote from script>\", \"note\": \"<what the FACE was doing on this beat and what to try>\"}], \"nextTake\": \"<the single most useful visual adjustment for the next take>\"} Include 1-3 beats about visible performance only. If the frames show no real performance, say that honestly in the headline and score low.";

  const content = [
    {
      type: "text",
      text: "SCRIPT:\n" + script + "\n\nDIRECTOR'S INTENT: " + intent + "\n" +
        (adjustment ? "ADJUSTMENT THIS TAKE: \"" + adjustment + "\" - judge how well the actor took this note, visually.\n" : "") +
        "\nAssess ONLY the visible performance in the frames below. Remember you cannot hear audio - return null for pacing and diction. Return the JSON.",
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
