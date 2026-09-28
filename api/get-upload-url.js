// Hands the app what it needs to upload a take straight to Cloudinary (an
// unsigned upload — no secret ships in the app). The app POSTs the recorded
// video to the returned endpoint with the preset, then sends the resulting
// public_id to /api/analyze, which fetches Cloudinary's on-the-fly audio
// extraction for transcription.
//
// Zero npm dependencies on purpose — this backend's build does not install
// packages, so everything here is built-in fetch/JSON only.
//
// The cloud name and UNSIGNED preset are NOT secrets — they're designed to live
// in client apps — so they're hardcoded as defaults here (env vars override).
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "di4i9twd9";
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || "acting_tapes";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const cloudName = CLOUD_NAME;
  const uploadPreset = UPLOAD_PRESET;

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
