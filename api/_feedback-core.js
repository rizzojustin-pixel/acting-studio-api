// In-app feedback → GitHub issue: pure, testable core.
//
// The HTTP handler (../feedback.js) validates the request with these helpers
// and turns it into a GitHub issue payload. No network or env access here so
// tests (node --test) can pin the validation rules and the rendered issue.

export const MAX_MESSAGE_LEN = 4000;
export const MAX_EMAIL_LEN = 254;
export const MAX_CONTEXT_LEN = 6000;

/** Categories the app can send. Anything else falls back to "general". */
export const FEEDBACK_CATEGORIES = ["bug", "idea", "praise", "general"];

const LABELS = {
  bug: ["feedback", "bug"],
  idea: ["feedback", "enhancement"],
  praise: ["feedback", "praise"],
  general: ["feedback"],
};

const TITLE_PREFIX = {
  bug: "Bug",
  idea: "Idea",
  praise: "Praise",
  general: "Feedback",
};

function clampString(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/** Normalize a raw category into a known one, defaulting to "general". */
export function normalizeCategory(value) {
  const c = typeof value === "string" ? value.trim().toLowerCase() : "";
  return FEEDBACK_CATEGORIES.includes(c) ? c : "general";
}

/**
 * Validate an incoming feedback request. Returns
 * `{ ok: true, value }` with cleaned fields, or `{ ok: false, error }` with a
 * user-facing message. The message is the only required field.
 *
 * @param {unknown} body
 */
export function validateFeedback(body) {
  const b = body && typeof body === "object" ? body : {};
  const message = clampString(b.message, MAX_MESSAGE_LEN);
  if (!message) {
    return { ok: false, error: "Please include a message." };
  }
  const email = clampString(b.email, MAX_EMAIL_LEN);
  // Loose sanity check only — a wrong-looking email shouldn't block feedback,
  // so we just drop it rather than reject the whole submission.
  const validEmail = email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "";
  return {
    ok: true,
    value: {
      message,
      email: validEmail,
      category: normalizeCategory(b.category),
      context: clampString(b.context, MAX_CONTEXT_LEN),
      appVersion: clampString(b.appVersion, 40),
      platform: clampString(b.platform, 40),
    },
  };
}

/** Short, single-line title derived from the first line of the message. */
export function buildIssueTitle(category, message) {
  const firstLine = String(message || "").split("\n")[0].trim();
  const snippet = firstLine.length > 72 ? firstLine.slice(0, 69) + "…" : firstLine;
  return `[${TITLE_PREFIX[category] || "Feedback"}] ${snippet || "In-app feedback"}`;
}

/**
 * Render a GitHub issue payload from validated feedback. Pure — the caller adds
 * auth and POSTs it. `receivedAtIso` is injected (not read from the clock) so
 * the output is deterministic and testable.
 *
 * @param {ReturnType<typeof validateFeedback>["value"]} value
 * @param {string} [receivedAtIso]
 */
export function buildIssue(value, receivedAtIso) {
  const lines = [value.message, "", "---"];
  const meta = [];
  if (value.email) meta.push(`**From:** ${value.email}`);
  if (value.platform) meta.push(`**Platform:** ${value.platform}`);
  if (value.appVersion) meta.push(`**App version:** ${value.appVersion}`);
  if (receivedAtIso) meta.push(`**Received:** ${receivedAtIso}`);
  meta.push("_Filed automatically from in-app feedback._");
  lines.push(...meta);
  if (value.context) {
    lines.push("", "<details><summary>Context</summary>", "", "```", value.context, "```", "</details>");
  }
  return {
    title: buildIssueTitle(value.category, value.message),
    body: lines.join("\n"),
    labels: LABELS[value.category] || LABELS.general,
  };
}

/** Parse "owner/repo" into { owner, repo }, or null when malformed. */
export function parseRepo(repo) {
  if (typeof repo !== "string") return null;
  const m = repo.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}
