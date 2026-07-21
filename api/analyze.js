// Acting Studio — AI Director backend (OpenAI, video frames + audio transcript)
// Two-step: 1) transcribe audio via Whisper, 2) score performance with GPT-4o vision.
// Env var required: OPENAI_API_KEY

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

  const capped = Array.isArray(frames) ? frames.slice(0, 4) : [];

  if (capped.length < 2) {
    return res.status(200).json({
      castable: null,
      headline: "We couldn't detect a performance. Record again, facing the camera with good light.",
      strength: null,
      pillars: {
        emotion: { score: null, note: "Not enough of the take was captured to assess." },
        pacing: { score: null, note: "Not assessed." },
        eyeline: { score: null, note: "Not enough of the take was captured to assess." },
        diction: { score: null, note: "Not assessed." },
      },
      beats: [],
      nextTake: "Make sure you're in frame and the lighting is good, then run the scene again.",
    });
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

  // ---- eye-line context based on how they filmed ----
  let eyelineContext;
  if (scriptMode === "off") {
    eyelineContext = "The actor filmed OFF-BOOK with NO lines on screen. Hold them to a professional standard on eye-line - wandering or unfocused eyes is a real note.";
  } else if (scriptMode === "near_lens") {
    eyelineContext = "The actor had lines NEAR THE LENS at the top of the screen. Be moderately lenient - small upward glances are reading, not a flaw.";
  } else {
    eyelineContext = "The actor had lines at the BOTTOM of the screen (rehearsal mode). Do NOT heavily penalize downward glances - they were reading. Judge whether they lifted out of the script and connected.";
  }

  // ---- audio context: only assess voice if we actually heard it ----
  let audioContext, pacingNull, dictionNull;
  if (heardAudio) {
    audioContext = "You CAN now assess the voice. Here is the transcript of what the actor said: \"" + transcript + "\". Use it to judge PACING (rhythm, where they rushed or let a beat land) and DICTION (clarity, whether words landed, energy sustained to the end of lines). Give real scores for pacing and diction.";
    pacingNull = false;
    dictionNull = false;
  } else {
    audioContext = "No audio was available for this take, so you CANNOT assess the voice. Return null for pacing and diction with the note 'Not assessed - no audio detected.'";
    pacingNull = true;
    dictionNull = true;
  }

  const systemPrompt =
    "You are a sharp, experienced film and television acting coach reviewing a self-tape. Twenty years coaching working actors. Honest, specific, never generic. You always name one real strength before the critiques - actors improve faster knowing what works. You are shown still frames from the take" +
    (heardAudio ? " AND a transcript of the audio." : " (no audio this time).") +
    " Judge facial expression, emotional truth, eye-line, and physical presence from the frames. " +
    audioContext +
    " EYE-LINE CONTEXT: " + eyelineContext +
    " If the frames show a blank, static, disengaged face, score LOW - do not reward sitting still. RUBRIC: Emotional Variety - blank/static 25-40, one-note committed 50-60, genuine variety 75+. Return ONLY valid JSON, no markdown, no backticks, no preamble, exact shape: {\"castable\": <integer 25-98>, \"headline\": \"<one honest sentence>\", \"strength\": \"<one genuine sentence naming what's working>\", \"pillars\": {\"emotion\": {\"score\": <0-100>, \"note\": \"<one sentence>\"}, \"pacing\": {\"score\": " +
    (pacingNull ? "null" : "<0-100>") +
    ", \"note\": \"<one sentence" + (pacingNull ? ", must be 'Not assessed - no audio detected.'" : "") + "\"}, \"eyeline\": {\"score\": <0-100>, \"note\": \"<one sentence per the context>\"}, \"diction\": {\"score\": " +
    (dictionNull ? "null" : "<0-100>") +
    ", \"note\": \"<one sentence" + (dictionNull ? ", must be 'Not assessed - no audio detected.'" : "") + "\"}}, \"beats\": [{\"line\": \"<short quote from script>\", \"note\": \"<what happened and what to try>\"}], \"nextTake\": \"<single most useful adjustment>\"} Include 1-3 beats.";

  const content = [
    {
      type: "text",
      text:
        "SCRIPT:\n" + script + "\n\nDIRECTOR'S INTENT: " + intent + "\n" +
        (adjustment ? "ADJUSTMENT THIS TAKE: \"" + adjustment + "\" - judge how well they took the note.\n" : "") +
        "\nAssess the take using the frames" + (heardAudio ? " and transcript" : "") + " and return the JSON.",
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
    parsed.heardAudio = heardAudio;
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Analysis failed", detail: String(e) });
  }
}
