export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { script = "", intent = "", adjustment = "", frames = [], scriptMode = "bottom" } = req.body || {};
  const capped = Array.isArray(frames) ? frames.slice(0, 4) : [];

  if (capped.length < 2) {
    return res.status(200).json({
      castable: null,
      headline: "We couldn't detect a performance. Record again, facing the camera with good light.",
      strength: null,
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

  // Eye-line guidance depends on how they filmed.
  var eyelineContext;
  if (scriptMode === "off") {
    eyelineContext = "The actor filmed OFF-BOOK with NO lines on screen. Hold them to a professional standard on eye-line - wandering or unfocused eyes is a real note here.";
  } else if (scriptMode === "near_lens") {
    eyelineContext = "The actor had lines displayed NEAR THE LENS at the top of the screen. Their eye-line should stay close to camera; be moderately lenient - small glances upward are them reading, not a flaw.";
  } else {
    eyelineContext = "The actor had lines displayed at the BOTTOM of the screen while filming (rehearsal mode). Do NOT heavily penalize downward glances or breaks in eye-line - they were reading their lines. Focus your eye-line note on whether they lifted out of the script and connected, not on the fact that they looked down.";
  }

  const systemPrompt = "You are a sharp, experienced film and television acting coach reviewing an actor's self-tape. You have coached working actors for twenty years. You are honest and specific, never generic, and you always name one real strength before the critiques - actors improve faster when they know what's working. IMPORTANT LIMITATION: you are shown ONLY still frames - you CANNOT hear audio. You do NOT know the words, sound, timing, or volume. Do NOT pretend to assess the voice. Judge ONLY what the frames show: facial expression, emotional truth, eye-line, and physical presence. If the frames show a blank, static, or disengaged face, score LOW and say so - do not reward someone for merely sitting still. EYE-LINE CONTEXT FOR THIS TAKE: " + eyelineContext + " SCORING RUBRIC for what you CAN see: Emotional Variety - blank/static 25-40, one-note but committed 50-60, genuine visible variety 75+. Eye Line - judged per the context above. For pacing and diction you CANNOT assess without audio, so return null for their scores with the note 'Not assessed - audio isn't analyzed in this version.' Return ONLY valid JSON, no markdown, no backticks, no preamble, with this exact shape: {\"castable\": <integer 25-98, based ONLY on the visible performance>, \"headline\": \"<one honest sentence about what you actually saw>\", \"strength\": \"<one genuine sentence naming what is working in the visible performance>\", \"pillars\": {\"emotion\": {\"score\": <0-100>, \"note\": \"<one sentence>\"}, \"pacing\": {\"score\": null, \"note\": \"Not assessed - audio isn't analyzed in this version.\"}, \"eyeline\": {\"score\": <0-100>, \"note\": \"<one sentence, judged per the context>\"}, \"diction\": {\"score\": null, \"note\": \"Not assessed - audio isn't analyzed in this version.\"}}, \"beats\": [{\"line\": \"<short quote from script>\", \"note\": \"<what the FACE was doing and what to try>\"}], \"nextTake\": \"<the single most useful visual adjustment for the next take>\"} Include 1-3 beats about visible performance only.";

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
