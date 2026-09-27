// TEMPORARY diagnostic — verifies the audio pipeline's dependencies actually
// load on Vercel's runtime (they load locally but the runtime differs). Remove
// once the pipeline is confirmed working.
import { existsSync } from "node:fs";

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  const out = { node: process.version, hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN };

  try {
    const blob = await import("@vercel/blob");
    out.blob = {
      ok: true,
      issueSignedToken: typeof blob.issueSignedToken,
      presignUrl: typeof blob.presignUrl,
      del: typeof blob.del,
    };
  } catch (e) {
    out.blob = { ok: false, detail: String((e && e.stack) || e) };
  }

  try {
    const ffmpeg = (await import("ffmpeg-static")).default;
    out.ffmpeg = {
      ok: true,
      path: String(ffmpeg),
      binaryExists: ffmpeg ? existsSync(ffmpeg) : false,
    };
  } catch (e) {
    out.ffmpeg = { ok: false, detail: String((e && e.stack) || e) };
  }

  return res.status(200).json(out);
}
