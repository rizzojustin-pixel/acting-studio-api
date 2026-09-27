// TEMPORARY diagnostic — inspects the deployed function filesystem to see
// whether Vercel installed/bundled the npm dependencies. Remove afterward.
import { existsSync, readdirSync } from "node:fs";

export const config = { maxDuration: 10 };

function safe(fn) {
  try {
    return fn();
  } catch (e) {
    return String((e && e.message) || e);
  }
}

export default async function handler(req, res) {
  const out = {
    build: "v4-installonly",
    node: process.version,
    cwd: process.cwd(),
    hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    task: safe(() => readdirSync("/var/task")),
    taskNodeModulesExists: safe(() => existsSync("/var/task/node_modules")),
    taskNodeModules: safe(() =>
      existsSync("/var/task/node_modules")
        ? readdirSync("/var/task/node_modules").slice(0, 60)
        : "(none)",
    ),
    cwdNodeModules: safe(() =>
      existsSync(process.cwd() + "/node_modules")
        ? readdirSync(process.cwd() + "/node_modules").slice(0, 60)
        : "(none)",
    ),
    blobDirExists: safe(() => existsSync("/var/task/node_modules/@vercel/blob")),
    ffmpegDirExists: safe(() => existsSync("/var/task/node_modules/ffmpeg-static")),
  };
  return res.status(200).json(out);
}
