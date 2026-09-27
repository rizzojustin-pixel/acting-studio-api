// Mints a short-lived presigned PUT URL so the app can upload a recorded take
// directly to Vercel Blob (bypassing the 4.5 MB serverless request-body limit).
// The app then sends the returned `pathname` to /api/analyze, which pulls the
// audio out of the video for transcription and deletes the blob afterward.
//
// Requires BLOB_READ_WRITE_TOKEN in the environment (auto-added when a Vercel
// Blob store is connected to the project).
import { randomUUID } from "node:crypto";
import { issueSignedToken, presignUrl } from "@vercel/blob";

export const config = { maxDuration: 10 };

const ALLOWED_TYPES = ["video/quicktime", "video/mp4"];
const MAX_BYTES = 200 * 1024 * 1024; // generous ceiling; real takes are far smaller

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Storage not configured yet — tell the app so it can analyze frames-only
    // instead of hanging on an upload that can't succeed.
    return res.status(503).json({ error: "Storage not configured." });
  }

  try {
    const ext = req.body && req.body.ext === "mp4" ? "mp4" : "mov";
    const pathname = `tapes/${randomUUID()}.${ext}`;

    const token = await issueSignedToken({
      pathname,
      operations: ["put"],
      allowedContentTypes: ALLOWED_TYPES,
      maximumSizeInBytes: MAX_BYTES,
      validUntil: Date.now() + 30 * 60 * 1000,
    });

    const { presignedUrl } = await presignUrl(token, {
      operation: "put",
      pathname,
      access: "public",
      allowOverwrite: true,
      addRandomSuffix: false,
    });

    return res.status(200).json({ uploadUrl: presignedUrl, pathname });
  } catch (e) {
    console.error("[upload-url] failed", e);
    return res.status(500).json({ error: "Could not prepare upload." });
  }
}
