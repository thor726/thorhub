/**
 * mock-provider.js — Provider API tiruan yang kompatibel dengan format OpenAI.
 *
 * Dipakai untuk menguji gateway TANPA memakai Master API Key asli,
 * sehingga tidak membakar kredit. Jalankan di terminal terpisah:
 *
 *   npm run mock                       (port 9999, jeda respons 800ms)
 *   MOCK_PORT=9999 MOCK_DELAY_MS=2000 npm run mock
 *
 * Lalu arahkan gateway ke mock, di .env:
 *   TARGET_API_BASE_URL=http://localhost:9999/v1
 */
const express = require("express");

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.MOCK_PORT || "9999", 10);
const DELAY_MS = parseInt(process.env.MOCK_DELAY_MS || "800", 10);

const hitTimestamps = [];
let totalHits = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

function chunkOf(model, delta, finishReason = null) {
  return {
    id: "chatcmpl-mock-" + Date.now(),
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

app.post("/v1/chat/completions", async (req, res) => {
  const body = req.body || {};
  hitTimestamps.push(Date.now());
  totalHits++;

  const messagesJson = JSON.stringify(body.messages || []);
  const promptTokens = 10 + (messagesJson.length % 20);
  const completionText = `Halo! Ini respons mock dari provider lokal (model: ${body.model || "mock-model"}).`;
  const completionTokens = Math.ceil(completionText.length / 4);
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };

  // ---- Mode streaming (SSE) ----
  if (body.stream) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    const words = completionText.split(" ");
    for (const word of words) {
      res.write(sse(chunkOf(body.model || "mock-model", { role: "assistant", content: word + " " })));
      await sleep(Math.max(10, Math.floor(DELAY_MS / words.length)));
    }
    res.write(sse(chunkOf(body.model || "mock-model", {}, "stop")));
    // Chunk terakhir berisi usage — inilah yang di-"tap" oleh gateway
    res.write(
      sse({
        id: "chatcmpl-mock-" + Date.now(),
        object: "chat.completion.chunk",
        model: body.model || "mock-model",
        choices: [],
        usage,
      })
    );
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  // ---- Mode biasa (JSON) ----
  await sleep(DELAY_MS);
  res.json({
    id: "chatcmpl-mock-" + Date.now(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model || "mock-model",
    choices: [
      { index: 0, message: { role: "assistant", content: completionText }, finish_reason: "stop" },
    ],
    usage,
  });
});

// Daftar model tiruan
app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "mock-gpt", object: "model", owned_by: "mock-provider" },
      { id: "mock-gpt-mini", object: "model", owned_by: "mock-provider" },
    ],
  });
});

// Statistik untuk verifikasi rate limit gateway (dipakai smoke test)
app.get("/stats", (_req, res) => {
  const cutoff = Date.now() - 60_000;
  while (hitTimestamps.length && hitTimestamps[0] < cutoff) hitTimestamps.shift();
  res.json({ total_hits: totalHits, hits_last_60s: hitTimestamps.length });
});

app.listen(PORT, () => {
  console.log(`Mock provider (OpenAI-compatible) berjalan di http://localhost:${PORT}`);
  console.log(`Delay respons: ${DELAY_MS} ms | Endpoint: POST /v1/chat/completions, GET /v1/models, GET /stats`);
});
