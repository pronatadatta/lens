//
//  api/summarize.js
//  Lens — on-demand summarization
//
//  A Vercel Function so the glasses can summarize without ever holding a
//  Groq key. The viewer is public: anything in config.js ships to every
//  browser that opens it, so the key has to live somewhere the browser
//  cannot read. It lives here, in the GROQ_API_KEY environment variable,
//  and never leaves the server.
//
//  Never called at upload time. A row's `summary` stays null until someone
//  explicitly asks for one, which is what keeps publishing free.
//
//  CommonJS on purpose: a root package.json would change how Vercel
//  detects this project, which currently deploys as static files with no
//  build step (see vercel.json).
//

// Same project as public/config.js. The anon key is public by design and
// constrained by the RLS policies in setup.sql — it is duplicated here
// rather than read from config.js because a serverless function has no
// access to the static bundle. Keep these two in sync.
const SUPABASE_URL = "https://hyycnbjoxqnkpicjptap.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5eWNuYmpveHFua3BpY2pwdGFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NjIzMTYsImV4cCI6MjEwMTUzODMxNn0.rU1JBjuY6s3GlIGmSn_Ueqx-5AbAdbOQUIYiLsuzIHU";

// Matches Lawrence's GroqTranslationProvider.modelID so a summary reads the
// same whichever surface asked for it.
const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Long OCR dumps are mostly repetition past this point, and an unbounded
// body is the one way a single call could get expensive.
const MAX_INPUT_CHARS = 12000;

// Lifted from Lawrence's GroqSummarizationProvider so both surfaces produce
// the same kind of answer.
const SYSTEM_PROMPT = `You explain real-world text for a curious general audience. You receive raw text pulled by OCR from a photo — it might be a museum placard, the back of a medicine box, a technical spec, a legal notice, a sign, or a product label. The text may be messy, out of order, or in another language.

Write a clear, accurate summary that a high-school student can understand:
- Always write the summary in English, whatever language the input is in.
- Lead with a one-sentence plain-language gist of what this text is about.
- Then give the key points as a few short bullets.
- Explain any technical, medical, or legal terms in everyday words.
- Preserve specifics that matter (doses, warnings, dates, numbers, names) — make them clearer, never drop or invent them.
- Do NOT add facts that aren't in the text. If something is unclear or cut off, say so briefly rather than guessing.
- No preamble, no "Here is the summary" — start directly.
- Keep it under 150 words: this is read on a 600x600 heads-up display.`;

function supabaseHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  // Vercel usually parses JSON for us; tolerate a raw string either way.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const photoId = body && body.photo_id;
  if (!photoId || typeof photoId !== "string") {
    return res.status(400).json({ error: "photo_id is required." });
  }

  if (!process.env.GROQ_API_KEY) {
    // Said plainly: this is the one piece of setup that cannot be done
    // from the code, and a vague 500 here would be a bad afternoon.
    return res.status(500).json({
      error: "GROQ_API_KEY is not set on this deployment. Add it in the Vercel project's Environment Variables and redeploy."
    });
  }

  try {
    // ---- 1. read the row -------------------------------------------------
    const rowUrl = `${SUPABASE_URL}/rest/v1/photos` +
      `?select=id,ocr_text,summary,summary_model&id=eq.${encodeURIComponent(photoId)}&limit=1`;
    const rowRes = await fetch(rowUrl, { headers: supabaseHeaders() });
    if (!rowRes.ok) {
      return res.status(502).json({ error: `Could not read the photo row (HTTP ${rowRes.status}).` });
    }
    const rows = await rowRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return res.status(404).json({ error: "No photo with that id." });

    // ---- 2. cached? ------------------------------------------------------
    // The cache is also the rate limit. This endpoint is public, but a
    // caller can only ever provoke one Groq call per photo — the same call
    // the owner was going to pay for anyway. Re-summarizing is not offered.
    if (row.summary && row.summary.trim()) {
      return res.status(200).json({
        summary: row.summary,
        cached: true,
        model: row.summary_model || null
      });
    }

    const text = (row.ocr_text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "This photo has no extracted text to summarize." });
    }

    // ---- 3. summarize ----------------------------------------------------
    const groqRes = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text.slice(0, MAX_INPUT_CHARS) }
        ]
      })
    });

    if (!groqRes.ok) {
      const detail = (await groqRes.text()).slice(0, 200);
      return res.status(502).json({ error: `Groq returned HTTP ${groqRes.status}. ${detail}` });
    }

    const completion = await groqRes.json();
    const summary = completion &&
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      (completion.choices[0].message.content || "").trim();

    if (!summary) {
      return res.status(502).json({ error: "Groq returned an empty summary." });
    }

    // ---- 4. cache it back ------------------------------------------------
    // Best effort: the caller already has a usable summary, and failing the
    // whole request because the write failed would waste a paid call. A
    // failed cache just means the next request pays for it again.
    let cachedOk = true;
    try {
      const patch = await fetch(
        `${SUPABASE_URL}/rest/v1/photos?id=eq.${encodeURIComponent(photoId)}`,
        {
          method: "PATCH",
          headers: supabaseHeaders(),
          body: JSON.stringify({
            summary: summary,
            summary_at: new Date().toISOString(),
            summary_model: GROQ_MODEL
          })
        }
      );
      cachedOk = patch.ok;
    } catch (_) {
      cachedOk = false;
    }

    return res.status(200).json({
      summary: summary,
      cached: false,
      stored: cachedOk,
      model: GROQ_MODEL
    });
  } catch (err) {
    return res.status(500).json({ error: `Summarization failed: ${String(err && err.message || err)}` });
  }
};
