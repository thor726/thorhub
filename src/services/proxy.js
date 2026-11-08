/**
 * proxy.js — Logika inti forwarding request pembeli ke provider utama.
 *
 * Alur satu request:
 *   runJob()
 *     ├─ pasang timer "timeout antrean" (QUEUE_WAIT_TIMEOUT_MS, default 60 dtk)
 *     ├─ antre di limiter (Bottleneck: 25 RPM, maks 3 paralel)
 *     ├─ task() dieksekusi saat giliran tiba
 *     │    └─ doForward() → fetch ke provider dengan MASTER_API_KEY
 *     ├─ response diteruskan utuh ke pembeli
 *     └─ usage.total_tokens dicatat ke kolom tokens_used di database
 */
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const config = require("../config");
const db = require("../db");
const limiter = require("./limiter");

// Prepared statement: dibuat sekali, cepat & bebas SQL injection
const stmtAddUsage = db.prepare("UPDATE api_keys SET tokens_used = tokens_used + ? WHERE id = ?");
const stmtGetKeyById = db.prepare("SELECT * FROM api_keys WHERE id = ?");
const stmtLogUsage = db.prepare(
  `INSERT INTO usage_logs (api_key_id, model, prompt_tokens, completion_tokens, total_tokens, status)
   VALUES (?, ?, ?, ?, ?, ?)`
);

/** Error yang membawa status + body dari provider (diteruskan apa adanya). */
class UpstreamError extends Error {
  constructor(status, body) {
    super(`Provider utama merespons dengan status ${status}`);
    this.name = "UpstreamError";
    this.status = status;
    this.body = body;
  }
}

/** Error saat pembeli terlalu lama mengantre (melewati QUEUE_WAIT_TIMEOUT_MS). */
class QueueTimeoutError extends Error {
  constructor() {
    super(
      `Server sedang sibuk: request tidak mendapat giliran dalam ${Math.round(
        config.queueWaitTimeoutMs / 1000
      )} detik. Silakan coba lagi beberapa saat lagi.`
    );
    this.name = "QueueTimeoutError";
    this.status = 503;
  }
}

/** Gabungkan beberapa AbortSignal jadi satu (kompatibel Node < 20). */
function combineSignals(...signals) {
  const valid = signals.filter(Boolean);
  if (typeof AbortSignal.any === "function") return AbortSignal.any(valid);

  const combined = new AbortController();
  for (const signal of valid) {
    if (signal.aborted) combined.abort(signal.reason);
    else signal.addEventListener("abort", () => combined.abort(signal.reason), { once: true });
  }
  return combined.signal;
}

/** Ambil total token dari objek usage: utamakan total_tokens, fallback prompt+completion. */
function extractTotalTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  if (Number.isFinite(usage.total_tokens)) return usage.total_tokens;
  const prompt = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0;
  const completion = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : 0;
  return prompt + completion;
}

/**
 * Tambahkan pemakaian token pembeli ke database + catat ke log pemakaian.
 * @param {object} subKey  baris api_keys milik pembeli
 * @param {number} total   token yang dipotong dari kuota (sudah dikali multiplier model)
 * @param {{model?:string, prompt?:number, completion?:number, status?:string}} info  detail untuk log
 */
function countTokens(subKey, total, info = {}) {
  const model = info.model || null;
  const prompt = Number.isFinite(info.prompt) ? info.prompt : 0;
  const completion = Number.isFinite(info.completion) ? info.completion : 0;
  const status = info.status || "ok";

  if (!total || total <= 0) {
    // Tetap catat kejadiannya supaya member bisa melihat request yang tidak tercatat tokennya
    try {
      stmtLogUsage.run(subKey.id, model, prompt, completion, 0, status === "ok" ? "no_usage" : status);
    } catch { /* log gagal tidak boleh mengganggu request */ }
    console.warn(`[token] PERINGATAN: usage tidak ada di response provider — token tidak dihitung (key #${subKey.id})`);
    return;
  }

  stmtAddUsage.run(total, subKey.id);
  try {
    stmtLogUsage.run(subKey.id, model, prompt, completion, total, status);
  } catch (e) {
    console.error("[token] gagal menulis usage_logs:", e.message);
  }
  const updated = stmtGetKeyById.get(subKey.id);
  console.log(
    `[token] ${subKey.api_key.slice(0, 16)}… (${subKey.user_name}) +${total} token [${model || "?"}] → ${updated.tokens_used}/${updated.token_limit}`
  );
}

/**
 * Forward satu request ke provider utama dan tulis hasilnya ke `res`.
 * Melempar error terklasifikasi (UpstreamError / QueueTimeoutError / abort).
 */
async function doForward(state, subKey, payload, res) {
  // Opsional: inject include_usage untuk request streaming agar token tetap terhitung
  if (
    config.injectStreamUsage &&
    payload.stream === true &&
    !(payload.stream_options && payload.stream_options.include_usage)
  ) {
    payload = { ...payload, stream_options: { ...(payload.stream_options || {}), include_usage: true } };
  }

  const isStreamRequest = payload.stream === true;
  let response;

  try {
    response = await fetch(`${config.targetBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Request ke provider selalu memakai MASTER_API_KEY, bukan key pembeli
        Authorization: `Bearer ${config.masterApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: combineSignals(state.ac.signal, AbortSignal.timeout(config.upstreamTimeoutMs)),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      const e = new Error(`Provider utama tidak merespons dalam ${config.upstreamTimeoutMs / 1000} detik.`);
      e.name = "UpstreamTimeoutError";
      e.status = 504;
      throw e;
    }
    if (state.ac.signal.aborted) {
      err.isAbort = true; // dibatalkan: timeout antrean / client memutus koneksi
      throw err;
    }
    const e = new Error(`Gagal menghubungi provider utama: ${err.message}`);
    e.name = "UpstreamError";
    e.status = 502;
    e.body = { error: { message: e.message, type: "upstream_error", code: "provider_unreachable" } };
    throw e;
  }

  // Error dari provider → teruskan status & body apa adanya ke pembeli
  if (!response.ok) {
    // Provider bilang kewalahan (429) → kurangi sementara kapasitas antrean gateway
    // agar request berikutnya lebih jarang, sampai reservoir ter-refresh lagi.
    if (response.status === 429 && typeof limiter.incrementReservoir === "function") {
      limiter.incrementReservoir(-2).catch(() => {});
    }
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: { message: text || `Provider error (HTTP ${response.status})`, type: "upstream_error" } };
    }
    throw new UpstreamError(response.status, body);
  }

  const contentType = response.headers.get("content-type") || "";

  // Mode streaming: pipe SSE + "tap" untuk mencatat usage di chunk terakhir
  if ((isStreamRequest || contentType.includes("text/event-stream")) && response.body) {
    return streamToClient(response, res, subKey, payload.model);
  }

  // Mode biasa: baca JSON, hitung token, kembalikan response utuh
  const data = await response.json();
  const u = data.usage || {};
  countTokens(subKey, extractTotalTokens(data.usage), {
    model: data.model || payload.model,
    prompt: u.prompt_tokens,
    completion: u.completion_tokens,
  });
  res.status(response.status).json(data);
}

/**
 * Pipe response SSE dari provider ke pembeli sambil memantau baris `data:`.
 * Banyak provider menyisipkan objek `usage` pada chunk terakhir — di situlah
 * token dihitung.
 */
async function streamToClient(response, res, subKey, reqModel) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const upstream = Readable.fromWeb(response.body);
  let buffer = "";
  let counted = false;

  upstream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]" || counted) continue;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.usage) {
          counted = true;
          const u = parsed.usage;
          countTokens(subKey, extractTotalTokens(u), {
            model: parsed.model || reqModel,
            prompt: u.prompt_tokens,
            completion: u.completion_tokens,
          });
        }
      } catch {
        /* baris belum utuh / bukan JSON — abaikan */
      }
    }
  });

  try {
    await pipeline(upstream, res);
  } catch {
    // Koneksi pembeli terputus di tengah streaming — cukup tutup koneksi
    if (!res.writableEnded) res.destroy();
  }
}

/**
 * Menjadwalkan satu request melalui limiter lalu meneruskannya ke provider.
 * Menangani: timeout antrean, pembatalan oleh client, dan error berformat OpenAI.
 */
async function runJob({ req, res, subKey, payload }) {
  const state = { cancelled: false, reason: null, ac: new AbortController() };

  // ---- Timer timeout antrean ----
  const queueTimer = setTimeout(() => {
    state.cancelled = true;
    state.reason = "queue_timeout";
    state.ac.abort();
    // Kabari pembeli SEKARANG (jangan menunggu giliran yang mungkin datang 60 dtk lagi)
    if (!res.headersSent) {
      res.status(503).json({
        error: {
          message: new QueueTimeoutError().message,
          type: "queue_timeout_error",
          code: "queue_timeout",
        },
      });
    }
  }, config.queueWaitTimeoutMs);

  // Jika pembeli memutus koneksi, batalkan job (hemat kuota provider).
  // Catatan: deteksi yang benar adalah event 'close' pada RESPONSE — event 'close'
  // pada req malah ter-trigger saat body request selesai dibaca.
  const onClientClose = () => {
    if (res.writableEnded) return; // respons selesai normal, bukan disconnect
    state.cancelled = true;
    state.reason = state.reason || "client_disconnect";
    state.ac.abort();
  };
  res.on("close", onClientClose);

  const task = async () => {
    clearTimeout(queueTimer); // job mulai dieksekusi → hentikan penghitung antrean
    if (state.cancelled) {
      throw state.reason === "queue_timeout"
        ? new QueueTimeoutError()
        : Object.assign(new Error("dibatalkan"), { isAbort: true });
    }
    await doForward(state, subKey, payload, res);
  };

  try {
    // `expiration` = pengaman agar job yang menggantung tidak menyumbat slot paralel
    await limiter.schedule({ expiration: config.upstreamTimeoutMs + 10_000 }, task);
  } catch (err) {
    // Respons sudah/sedang dikirim → tidak bisa (tidak perlu) kirim error JSON lagi
    if (res.writableEnded || res.headersSent) {
      try {
        res.destroy();
      } catch {
        /* diabaikan */
      }
      return;
    }

    if (err instanceof QueueTimeoutError || state.reason === "queue_timeout") {
      return res.status(503).json({
        error: { message: err.message, type: "queue_timeout_error", code: "queue_timeout" },
      });
    }
    if (state.reason === "client_disconnect" || err.isAbort || err.name === "AbortError") {
      return; // pembeli sudah pergi — tidak ada yang perlu dibalas
    }
    if (err instanceof UpstreamError) {
      return res.status(err.status).json(err.body);
    }
    if (err.name === "UpstreamTimeoutError" || /timed out/i.test(err.message || "")) {
      return res.status(504).json({
        error: { message: "Provider utama tidak merespons tepat waktu.", type: "upstream_timeout" },
      });
    }
    console.error("[proxy] Kesalahan tak terduga:", err);
    return res.status(500).json({
      error: { message: "Kesalahan internal gateway.", type: "internal_error" },
    });
  } finally {
    clearTimeout(queueTimer);
    res.removeListener("close", onClientClose);
  }
}

module.exports = { runJob, countTokens, extractTotalTokens };
