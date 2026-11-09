/**
 * notify.js — Notifikasi pesanan via WhatsApp (Fonnte) & email (Resend).
 *
 * Porting dari src/lib/key-delivery.ts (sendWhatsApp) dan src/lib/email.ts
 * (Resend) di repo Thor-market, disederhanakan untuk proyek ini.
 *
 * Perbedaan penting dari Thor-market: struk email DI SINI MEMUAT API KEY
 * secara utuh — diminta eksplisit oleh pemilik toko ("token API dikirim ke
 * email juga"). Konsekuensinya: alamat email pembeli wajib benar; key di
 * email = kredensial, jadi email diarahkan agar segera disimpan aman.
 *
 * Semua pengiriman best-effort (timeout 10 detik): kegagalan tidak boleh
 * mengganggu alur fulfillment.
 */

/** Kirim pesan WhatsApp via Fonnte (https://fonnte.com) — best-effort. */
async function sendWhatsApp(token, target, message) {
  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ target, message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("Fonnte HTTP", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendWhatsApp error:", e.message);
    return false;
  }
}

/** Format Rupiah: 8000 → "Rp 8.000". */
function rupiah(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Susun HTML struk email (memuat API KEY — diminta pemilik toko). */
function buildEmailHtml(order) {
  const isNew = order.mode === "key_baru";
  const barisKey = isNew
    ? `<tr>
        <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">API Key Anda</td>
        <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;">
          <code style="word-break:break-all;font-size:12px;background:#f3f4f6;padding:4px 8px;border-radius:6px;display:inline-block;">${esc(order.api_key_issued)}</code>
        </td>
      </tr>`
    : `<tr>
        <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">Key Ditambah</td>
        <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;">${esc(order.target_api_key)}</td>
      </tr>`;

  return `<!doctype html>
<html lang="id">
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;">
    <tr>
      <td style="background:#0a0a0a;padding:28px 24px;">
        <p style="margin:0;font-size:20px;font-weight:bold;color:#e0e0e0;">Thor<span style="color:#a3e635;">Hub</span></p>
        <p style="margin:6px 0 0;font-size:13px;color:#a3e635;">Pembayaran Diterima — Pesanan ${esc(order.order_code)}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <p style="margin:0 0 4px;font-size:15px;color:#111827;">Halo ${esc(order.user_name)},</p>
        <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.6;">
          Terima kasih! Pembayaran pesanan Anda sudah kami terima.
          ${isNew ? "API Key baru Anda ada di bawah — simpan email ini." : "Kuota token key Anda sudah ditambahkan."}
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:16px;">
          <tr>
            <td style="padding:10px 12px;background:#f9fafb;font-size:12px;color:#6b7280;">Kode Pesanan</td>
            <td style="padding:10px 12px;background:#f9fafb;font-size:13px;color:#111827;font-weight:bold;text-align:right;">${esc(order.order_code)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">Paket</td>
            <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;">${esc(order.quota_tokens.toLocaleString("id-ID"))} token</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">Metode</td>
            <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;">${esc(order.payment_method)}</td>
          </tr>
          ${barisKey}
        </table>
        <p style="margin:0 0 18px;font-size:15px;font-weight:bold;color:#111827;text-align:right;">Total Dibayar: <span style="color:#d97706;">${rupiah(order.amount_to_pay)}</span></p>
        <div style="margin:0 0 18px;padding:16px;border:1px dashed #a3e635;border-radius:12px;background:#f7fee7;">
          <p style="margin:0;font-size:13px;color:#3f6212;line-height:1.7;">
            ${isNew
              ? "Aktifkan di mana saja: masuk ke <b>thormarket.site/portal</b> dengan API Key di atas, atau pakai langsung di header <b>Authorization: Bearer &lt;key&gt;</b>."
              : "Cek kuota terbaru kapan saja di dashboard member."}
            <br><b>Jaga kerahasiaan key Anda</b> — siapa pun yang memegang key memakai kuota Anda.
          </p>
        </div>
        <p style="margin:18px 0 0;font-size:12px;color:#6b7280;line-height:1.6;">
          Butuh bantuan? Balas email ini atau hubungi admin ThorHub.<br>
          Email otomatis — mohon jangan membalas dengan data kartu/kredensial apa pun.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Kirim email via Resend — best-effort. */
async function sendEmail(apiKey, from, to, subject, html) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("Resend HTTP", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendEmail error:", e.message);
    return false;
  }
}

/** Susun pesan WhatsApp untuk pembeli. */
function pesanWaPembeli(order) {
  const base = (require("../config").publicBaseUrl || "").replace(/\/+$/, "");
  const linkPortal = base ? `${base}/portal` : "halaman /portal";
  if (order.mode === "key_baru") {
    return [
      `✅ *Pembayaran diterima — ThorHub*`,
      ``,
      `Halo ${order.user_name}, pembayaran pesanan *${order.order_code}* sebesar *${rupiah(order.amount_to_pay)}* sudah kami terima.`,
      ``,
      `🎁 *API Key Anda:*`,
      `\`${order.api_key_issued}\``,
      ``,
      `• Kuota: ${order.quota_tokens.toLocaleString("id-ID")} token`,
      `• Masuk dashboard: ${linkPortal} (pakai API Key sebagai login)`,
      `• Cara pakai: header \`Authorization: Bearer <key>\``,
      ``,
      `_Simpan pesan ini — jangan bagikan key ke siapa pun._`,
    ].join("\n");
  }
  return [
    `✅ *Top-up berhasil — ThorHub*`,
    ``,
    `Halo ${order.user_name}, kuota untuk pesanan *${order.order_code}* sudah ditambahkan.`,
    ``,
    `• Key: \`${order.target_api_key.slice(0, 18)}…\``,
    `• Tambahan: +${order.quota_tokens.toLocaleString("id-ID")} token`,
    `• Total dibayar: ${rupiah(order.amount_to_pay)}`,
    ``,
    `_Terima kasih sudah memakai ThorHub!_`,
  ].join("\n");
}

/**
 * Kirim semua notifikasi pesanan LUNAS: WA pembeli, email pembeli, WA admin.
 * @param {object} order baris orders (lengkap, termasuk api_key_issued)
 * @returns {Promise<{waSent:boolean, emailSent:boolean, adminSent:boolean}>}
 */
async function kirimNotifikasiLunas(order) {
  const cfg = require("./store").getNotifySettings();
  const hasil = { waSent: false, emailSent: false, adminSent: false };
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((order.email || "").trim());

  // 1. WhatsApp ke pembeli
  if (cfg.waKePembeli && cfg.fonnteToken && order.whatsapp && order.status === "COMPLETED") {
    hasil.waSent = await sendWhatsApp(cfg.fonnteToken, order.whatsapp.replace(/^0/, "62"), pesanWaPembeli(order));
  }

  // 2. Email struk + key ke pembeli
  if (cfg.emailKePembeli && cfg.resendKey && cfg.emailFrom && emailValid && order.status === "COMPLETED") {
    hasil.emailSent = await sendEmail(
      cfg.resendKey,
      cfg.emailFrom,
      order.email.trim(),
      `Pembayaran Diterima — ${order.order_code} · ThorHub`,
      buildEmailHtml(order)
    );
  }

  // 3. WhatsApp ke admin (order lunas)
  if (cfg.fonnteToken && cfg.adminWa) {
    const teks = [
      `💰 *Order LUNAS — ThorHub*`,
      ``,
      `• Kode: ${order.order_code}`,
      `• Pembeli: ${order.user_name}`,
      `• Paket: ${order.quota_tokens.toLocaleString("id-ID")} token (${rupiah(order.amount_to_pay)})`,
      `• Mode: ${order.mode === "key_baru" ? "Key BARU" : "Top-up"}`,
      order.mode === "topup" ? `• Target: \`${order.target_api_key.slice(0, 18)}…\`` : "",
      hasil.waSent ? `• WA pembeli: terkirim ✓` : `• WA pembeli: ${order.whatsapp ? "gagal" : "tidak ada nomor"}`,
      hasil.emailSent ? `• Email pembeli: terkirim ✓` : `• Email pembeli: ${order.email ? "gagal/nonaktif" : "tidak ada"}`,
    ]
      .filter(Boolean)
      .join("\n");
    hasil.adminSent = await sendWhatsApp(cfg.fonnteToken, cfg.adminWa, teks);
  }

  return hasil;
}

/**
 * Notifikasi WA admin: pesanan BARU menunggu pembayaran (best-effort).
 */
async function notifyAdminNewOrder(order) {
  const cfg = require("./store").getNotifySettings();
  if (!cfg.fonnteToken || !cfg.adminWa) return false;
  const teks = [
    `🔔 *Order BARU — ThorHub*`,
    ``,
    `• Kode: ${order.order_code}`,
    `• Pembeli: ${order.user_name}`,
    `• Paket: ${order.quota_tokens.toLocaleString("id-ID")} token`,
    `• Bayar: *${rupiah(order.amount_to_pay)}* (QRIS DANA)`,
    `• Berlaku sampai: 2 jam`,
    ``,
    `_Menunggu notifikasi DANA masuk…_`,
  ].join("\n");
  return sendWhatsApp(cfg.fonnteToken, cfg.adminWa, teks);
}

module.exports = { sendWhatsApp, sendEmail, kirimNotifikasiLunas, notifyAdminNewOrder, pesanWaPembeli, rupiah };
