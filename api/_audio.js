// Audio extraction for the analyze endpoint.
//
// iOS will not let a self-tape app capture a separate voice track while the
// camera records video (the two fight over the mic and the second recorder
// gets silence). So the app now records ONE un-muted video and uploads it to
// Vercel Blob; here we pull just the audio out of that video with ffmpeg and
// hand back a small mp3 buffer for Whisper. The video blob is deleted right
// after, so tapes never linger in storage.
//
// Everything network/binary lives here (untestable in unit tests); analyze.js
// stays focused on the prompt + model call.
import { spawn } from "node:child_process";
import { readFile, writeFile, copyFile, chmod, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import ffmpegStatic from "ffmpeg-static";
import { issueSignedToken, presignUrl, del } from "@vercel/blob";

// ffmpeg-static resolves to a path string that Node File Trace sometimes fails
// to bundle with the execute bit intact — so copy it into the one writable dir
// (/tmp) and chmod it once per warm instance before spawning.
let ffmpegBinPromise = null;
function getFfmpeg() {
  if (!ffmpegBinPromise) {
    ffmpegBinPromise = (async () => {
      const bin = "/tmp/ffmpeg-bin";
      await copyFile(ffmpegStatic, bin);
      await chmod(bin, 0o755);
      return bin;
    })().catch((e) => {
      // Reset so a later request can retry rather than caching the failure.
      ffmpegBinPromise = null;
      throw e;
    });
  }
  return ffmpegBinPromise;
}

/** Presign a short-lived GET for a blob path and fetch its bytes. */
async function fetchBlob(pathname) {
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil: Date.now() + 10 * 60 * 1000,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    access: "public",
  });
  const resp = await fetch(presignedUrl);
  if (!resp.ok) throw new Error(`blob fetch failed (${resp.status})`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Best-effort delete so tapes never linger in storage. */
export async function deleteBlob(pathname) {
  try {
    await del(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (e) {
    console.warn("[audio] blob delete failed (non-fatal)", e?.message || e);
  }
}

/**
 * Fetch the uploaded take from Blob and extract a small mono 16 kHz mp3 for
 * Whisper. Returns a Buffer, or throws. Always cleans up its /tmp files; the
 * caller deletes the blob (see deleteBlob) so cleanup happens even on failure.
 */
export async function extractAudioFromBlob(pathname) {
  const inPath = `/tmp/in-${randomUUID()}`;
  const outPath = `/tmp/out-${randomUUID()}.mp3`;
  try {
    const video = await fetchBlob(pathname);
    await writeFile(inPath, video);

    const bin = await getFfmpeg();
    await new Promise((resolve, reject) => {
      const proc = spawn(bin, [
        "-i", inPath,
        "-vn", // drop the video stream
        "-ac", "1", // mono
        "-ar", "16000", // 16 kHz (Whisper's internal rate)
        "-b:a", "64k",
        "-f", "mp3",
        "-y", outPath,
      ]);
      let err = "";
      proc.stderr.on("data", (d) => {
        err += d.toString();
      });
      proc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`)),
      );
      proc.on("error", reject);
    });

    return await readFile(outPath);
  } finally {
    await Promise.allSettled([unlink(inPath), unlink(outPath)]);
  }
}
