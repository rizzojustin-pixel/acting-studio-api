// Hands the app what it needs to upload a take straight to Cloudinary (an
// unsigned upload — no secret ships in the app). The app POSTs the recorded
// video to the returned endpoint with the preset, then sends the resulting
// public_id to /api/analyze, which fetches Cloudinary's on-the-fly audio
// extraction for transcription.
//
// Zero npm dependencies on purpose — this backend's build does not install
// packages, so everything here is built-in fetch/JSON only.
//
// Env vars (set in Vercel → project → Settings → Environment Variables):
//   CLOUDINARY_CLOUD_NAME      e.g. "dxxxxxx"
//   CLOUDINARY_UPLOAD_PRESET   name of an UNSIGNED upload preset

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    // Not configured yet — the app falls back to analyzing frames only.
    return res.status(503).json({ error: "Upload storage not configured." });
  }

  return res.status(200).json({
    provider: "cloudinary",
    cloudName,
    uploadPreset,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
  });
}
