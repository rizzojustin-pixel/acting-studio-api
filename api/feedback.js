// In-app feedback → GitHub issue endpoint.
// Turns a user's tapped-out note into a labeled GitHub issue so the loop from
// "an actor hit a wall" to "we saw it" is one tap. Validation + rendering live
// in ./lib/feedback-core.js (tested); this file adds auth + the network call.
//
// POST { message, email?, category?, context?, appVersion?, platform? }
// -> { ok: true, url: "<issue html_url>" }
//
// Env vars:
//   GITHUB_TOKEN  - a fine-grained PAT with Issues: read/write on the repo
//   GITHUB_REPO   - "owner/repo" that receives the issues
import { validateFeedback, buildIssue, parseRepo } from "./_feedback-core.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const result = validateFeedback(req.body);
  if (!result.ok) return res.status(400).json({ error: result.error });

  const token = process.env.GITHUB_TOKEN;
  const target = parseRepo(process.env.GITHUB_REPO);
  if (!token || !target) {
    // Misconfiguration is ours, not the user's — don't lose their words.
    console.error("[feedback] missing GITHUB_TOKEN or GITHUB_REPO", {
      hasToken: !!token,
      repo: process.env.GITHUB_REPO,
    });
    return res.status(500).json({ error: "Feedback isn't set up yet. Please try again later." });
  }

  const receivedAt = new Date().toISOString();
  const issue = buildIssue(result.value, receivedAt);

  try {
    const r = await fetch(
      `https://api.github.com/repos/${target.owner}/${target.repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "acting-studio-feedback",
        },
        body: JSON.stringify(issue),
      },
    );

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("[feedback] GitHub error", r.status, data);
      return res.status(502).json({ error: "Couldn't file your feedback. Please try again." });
    }
    return res.status(200).json({ ok: true, url: data.html_url || null });
  } catch (e) {
    console.error("[feedback] request failed", e);
    return res.status(502).json({ error: "Couldn't reach the feedback service. Please try again." });
  }
}
