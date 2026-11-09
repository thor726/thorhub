/**
 * beli.js — Halaman toko pembelian (vanilla JS, tanpa build step).
 *
 * Alur: pilih mode (key baru / top-up) → pilih paket → isi data →
 * QRIS tampil (nominal + kode unik) → polling /store/order/:code tiap 5 dtk
 * → COMPLETED → API key tampil + tombol salin (dan terkirim email/WA).
 *
 * Pesanan aktif disimpan di localStorage agar reload halaman tidak
 * menghilangkan akses ke QR (access_token hanya diberikan sekali oleh server).
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rupiah = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const KUNCI_ORDER = "thorhub_order_aktif"; // { kode, token, expires_at }

let PAKET = [];
let mode = "key_baru";
let paketDipilih = null; // { id, label, tokens, price }
let pesanan = null; // { kode, token, expires_at, amount }
let pollTimer = null;
let countdownTimer = null;

/* ================= Muat katalog paket ================= */
async function muatPaket() {
  try {
    const r = await fetch("/store/packages");
    const d = await r.json();
    const data = d.data || {};
    PAKET = data.packages || [];
    if (!data.store_ready) {
      $("toko-status").innerHTML =
        '<div class="alert warn">Toko sedang <b>ditutup</b> — pembayaran QRIS belum diaktifkan admin. Silakan hubungi admin.</div>';
      $("form-beli").querySelector('button[type="submit"]').disabled = true;
    }
    gambarPaket();
  } catch {
    $("toko-status").innerHTML = '<div class="alert err">Gagal memuat katalog. Muat ulang halaman.</div>';
  }
}

function gambarPaket() {
  const wrap = $("pkg-grid");
  if (!PAKET.length) {
    wrap.innerHTML = '<p class="muted">Katalog tidak tersedia.</p>';
    return;
  }
  wrap.innerHTML = PAKET.map(
    (p, i) => `
    <button type="button" class="pkg${paketDipilih?.id === p.id ? " active" : ""}" data-id="${esc(p.id)}" style="--i:${i}">
      <span class="pkg-tok">${esc(p.label)}</span>
      <span class="pkg-unit">token</span>
      <span class="pkg-harga mono">${rupiah(p.price)}</span>
    </button>`
  ).join("");
}

$("pkg-grid").addEventListener("click", (e) => {
  const btn = e.target.closest(".pkg");
  if (!btn) return;
  paketDipilih = PAKET.find((p) => p.id === btn.dataset.id) || null;
  gambarPaket();
  perbaruiRingkasan();
});

/* ================= Mode key baru / top-up ================= */
function setMode(m) {
  mode = m;
  const baru = m === "key_baru";
  $("mode-key-baru").classList.toggle("active", baru);
  $("mode-topup").classList.toggle("active", !baru);
  $("mode-key-baru").setAttribute("aria-selected", baru);
  $("mode-topup").setAttribute("aria-selected", !baru);
  $("wrap-apikey").classList.toggle("hidden", baru);
  $("f-apikey").required = !baru;
  $("f-email").required = baru;
  $("label-email").innerHTML = baru ? 'Email <span class="req">*</span>' : "Email (untuk struk)";
  $("hint-email").textContent = baru ? "API key dikirim juga ke email ini." : "Struk pembayaran dikirim ke email ini.";
  perbaruiRingkasan();
}

$("mode-key-baru").addEventListener("click", () => setMode("key_baru"));
$("mode-topup").addEventListener("click", () => setMode("topup"));

function perbaruiRingkasan() {
  $("sum-paket").textContent = paketDipilih ? `${paketDipilih.label} token` : "—";
  $("sum-harga").textContent = paketDipilih ? rupiah(paketDipilih.price) : "—";
}

/* ================= Kirim pesanan ================= */
$("form-beli").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!paketDipilih) {
    pesanForm("Pilih salah satu paket di atas dulu.", false);
    return;
  }
  const btn = $("btn-beli");
  btn.disabled = true;
  $("form-msg").innerHTML = "";
  try {
    const body = {
      mode,
      package_id: paketDipilih.id,
      user_name: $("f-nama").value.trim(),
      email: $("f-email").value.trim(),
      whatsapp: $("f-wa").value.trim(),
    };
    if (mode === "topup") body.api_key = $("f-apikey").value.trim();
    const r = await fetch("/store/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "Gagal membuat pesanan.");

    const pay = d.data.payment;
    pesanan = {
      kode: pay.order_code,
      token: pay.access_token,
      expires_at: pay.expires_at,
      amount: pay.amount_to_pay,
      qr: pay.qr_image,
    };
    simpanOrderLokal();
    tampilPembayaran(pay.qr_image);
  } catch (err) {
    pesanForm(err.message, false);
  } finally {
    btn.disabled = false;
  }
});

function pesanForm(msg, ok = true) {
  $("form-msg").innerHTML = `<div class="alert ${ok ? "ok" : "err"}">${esc(msg)}</div>`;
}

/* ================= Tampilan pembayaran ================= */
function tampilPembayaran(qrImage) {
  $("step-form").classList.add("hidden");
  $("step-selesai").classList.add("hidden");
  $("step-bayar").classList.remove("hidden");
  $("bayar-msg").innerHTML = "";

  $("pay-kode").textContent = pesanan.kode;
  $("pay-amount").textContent = rupiah(pesanan.amount);
  $("pay-kode-unik").textContent = "+" + (paketDipilih ? pesanan.amount - paketDipilih.price : "—");
  $("pay-harga").textContent = paketDipilih ? rupiah(paketDipilih.price) : "—";
  $("pay-paket").textContent = paketDipilih ? `${paketDipilih.label} token` : "—";
  $("pay-badge").textContent = "menunggu pembayaran";
  $("pay-badge").className = "tag warn";
  setQr(qrImage);
  mulaiCountdown();
  mulaiPolling();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setQr(qrImage) {
  $("qr-loading").classList.add("hidden");
  if (qrImage) {
    $("qr-img").src = qrImage;
    $("qr-img").classList.remove("hidden");
  }
}

function mulaiCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  const perbarui = () => {
    const sisa = Math.max(0, pesanan.expires_at - Date.now());
    const m = Math.floor(sisa / 60000);
    const s = Math.floor((sisa % 60000) / 1000);
    $("pay-expired").textContent = `${m}mnt ${String(s).padStart(2, "0")}dtk`;
    if (sisa <= 0) {
      clearInterval(countdownTimer);
      $("pay-expired").textContent = "kedaluwarsa";
      hentikanPolling();
      tampilKedaluwarsa();
    }
  };
  perbarui();
  countdownTimer = setInterval(perbarui, 1000);
}

function tampilKedaluwarsa() {
  $("pay-badge").textContent = "kedaluwarsa";
  $("pay-badge").className = "tag off";
  $("bayar-msg").innerHTML =
    '<div class="alert warn">Tagihan kedaluwarsa. Silakan buat pesanan baru bila masih ingin membeli.</div>' +
    '<div class="row-actions"><button class="btn primary" onclick="location.href=\'/beli\'">Buat Pesanan Baru</button></div>';
  hapusOrderLokal();
}

/* ================= Polling status ================= */
function mulaiPolling() {
  hentikanPolling();
  pollTimer = setInterval(cekStatus, 5000);
  cekStatus();
}

function hentikanPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

let polling = false;
async function cekStatus() {
  if (polling || !pesanan) return;
  polling = true;
  try {
    const r = await fetch(`/store/order/${encodeURIComponent(pesanan.kode)}?t=${encodeURIComponent(pesanan.token)}`);
    const d = await r.json();
    const o = d.data || {};
    if (o.status === "PENDING" && o.qr_image && !$("qr-img").src) setQr(o.qr_image);
    if (o.status === "PAID") {
      $("pay-badge").textContent = "dibayar — menyiapkan key…";
      $("pay-badge").className = "tag ok";
    }
    if (o.status === "CANCELLED") {
      hentikanPolling();
      $("pay-badge").textContent = "dibatalkan";
      $("pay-badge").className = "tag off";
      $("bayar-msg").innerHTML =
        '<div class="alert warn">Pesanan dibatalkan / kedaluwarsa.</div><div class="row-actions"><button class="btn primary" onclick="location.href=\'/beli\'">Buat Pesanan Baru</button></div>';
      hapusOrderLokal();
    }
    if (o.status === "COMPLETED") {
      hentikanPolling();
      hapusOrderLokal();
      tampilSelesai(o);
    }
  } catch {
    /* jaringan gagal sesaat → coba lagi di tick berikutnya */
  } finally {
    polling = false;
  }
}

/* ================= Tampilan selesai ================= */
function tampilSelesai(o) {
  $("step-bayar").classList.add("hidden");
  $("step-selesai").classList.remove("hidden");

  if (o.mode === "key_baru") {
    const key = o.api_key || "";
    $("selesai-card").innerHTML = `
      <h1>
        <svg class="ico" style="width:30px;height:30px;color:var(--lime)" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        <span>Pembayaran <span class="grad">Berhasil!</span></span>
      </h1>
      <span class="eyebrow">pesanan ${esc(o.order_code)} · ${esc(o.quota_tokens.toLocaleString("id-ID"))} token</span>
      <p class="sub">API Key baru Anda sudah aktif. Salin dan simpan sekarang — key juga dikirim ke email &amp; WhatsApp Anda.</p>
      <div class="key-final mono" id="key-final">${esc(key)}</div>
      <div class="row-actions">
        <button class="btn primary" id="btn-salin-key" type="button">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Salin API Key
        </button>
        <a class="btn" href="/portal">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Masuk Portal Member
        </a>
      </div>
      <p class="muted" style="margin-bottom:0;font-size:13px">
        Login portal memakai API Key Anda sebagai kredensial. Jaga kerahasiaan key — siapa pun yang memegangnya memakai kuota Anda.
      </p>`;
    $("btn-salin-key").onclick = async () => {
      await navigator.clipboard.writeText(key);
      $("btn-salin-key").innerHTML = "✓ Tersalin";
      setTimeout(() => ($("btn-salin-key").textContent = "Salin API Key"), 1500);
    };
  } else {
    $("selesai-card").innerHTML = `
      <h1>
        <svg class="ico" style="width:30px;height:30px;color:var(--lime)" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        <span>Top-up <span class="grad">Berhasil!</span></span>
      </h1>
      <span class="eyebrow">pesanan ${esc(o.order_code)}</span>
      <p class="sub">
        Kuota <b>${esc((o.added_tokens || 0).toLocaleString("id-ID"))} token</b> sudah ditambahkan ke key
        <code class="mono">${esc(o.target_api_key_masked || "")}</code>.
        Struk sudah dikirim ke email &amp; WhatsApp Anda.
      </p>
      <div class="row-actions">
        <a class="btn primary" href="/portal">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>
          Cek Kuota di Portal
        </a>
      </div>`;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ================= Batalkan pesanan ================= */
$("btn-batal").addEventListener("click", async () => {
  if (!pesanan) return;
  if (!confirm("Batalkan pesanan ini? Tagihan QRIS akan tidak berlaku.")) return;
  try {
    await fetch(`/store/order/${encodeURIComponent(pesanan.kode)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: pesanan.token }),
    });
  } catch { /* abaikan */ }
  hentikanPolling();
  hapusOrderLokal();
  location.href = "/beli";
});

/* ================= Salin nominal ================= */
$("btn-salin-nominal").addEventListener("click", async () => {
  await navigator.clipboard.writeText(String(pesanan?.amount ?? ""));
  const b = $("btn-salin-nominal");
  b.innerHTML = "✓ Tersalin";
  setTimeout(() => (b.innerHTML = "Salin Nominal"), 1500);
});

/* ================= Pesanan aktif di localStorage ================= */
function simpanOrderLokal() {
  try {
    localStorage.setItem(KUNCI_ORDER, JSON.stringify(pesanan));
  } catch { /* localStorage nonaktif */ }
}
function bacaOrderLokal() {
  try {
    const raw = localStorage.getItem(KUNCI_ORDER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function hapusOrderLokal() {
  try {
    localStorage.removeItem(KUNCI_ORDER);
  } catch { /* abaikan */ }
}

/** Ada pesanan PENDING sebelumnya? Tawarkan lanjut bayar. */
async function tawarkanOrderLama() {
  const lama = bacaOrderLokal();
  if (!lama || !lama.kode || !lama.token) return;
  if (lama.expires_at <= Date.now()) {
    hapusOrderLokal();
    return;
  }
  try {
    const r = await fetch(`/store/order/${encodeURIComponent(lama.kode)}?t=${encodeURIComponent(lama.token)}`);
    if (!r.ok) {
      hapusOrderLokal();
      return;
    }
    const o = (await r.json()).data || {};
    if (o.status === "COMPLETED") {
      hapusOrderLokal();
      return;
    }
    if (o.status !== "PENDING") {
      hapusOrderLokal();
      return;
    }
    $("order-lama").innerHTML = `
      <div class="card order-lama">
        <h2>
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          Ada pesanan menunggu pembayaran
        </h2>
        <p class="muted" style="margin-top:0">
          Pesanan <b class="mono">${esc(lama.kode)}</b> sebesar <b>${rupiah(o.amount_to_pay)}</b> masih menunggu pembayaran
          (berlaku ${Math.ceil((lama.expires_at - Date.now()) / 60000)} menit lagi).
        </p>
        <div class="row-actions">
          <button class="btn primary" id="btn-lanjut" type="button">Lanjutkan Pembayaran</button>
          <button class="btn small" id="buang-lama" type="button">Abaikan</button>
        </div>
      </div>`;
    $("btn-lanjut").onclick = () => {
      pesanan = lama;
      $("order-lama").innerHTML = "";
      tampilPembayaran(lama.qr || "");
      // QR lama mungkin tak tersimpan → polling akan mengambil ulang
    };
    $("buang-lama").onclick = () => {
      hapusOrderLokal();
      $("order-lama").innerHTML = "";
    };
  } catch { /* abaikan */ }
}

/* ================= Parameter URL (?mode=&key=&paket=) ================= */
function bacaParameter() {
  const p = new URLSearchParams(location.search);
  if (p.get("mode") === "topup") {
    setMode("topup");
    const kunci = (p.get("key") || "").trim();
    if (kunci) $("f-apikey").value = kunci;
  }
  // Pra-pilih paket dari tautan harga (cth: /beli?paket=100m)
  const pid = (p.get("paket") || "").trim();
  if (pid && PAKET.length) {
    const pilih = PAKET.find((x) => x.id === pid);
    if (pilih) {
      paketDipilih = pilih;
      gambarPaket();
    }
  }
}

/* ================= Boot ================= */
(async () => {
  await muatPaket(); // katalog dulu...
  bacaParameter(); // ...baru parameter ?paket= bisa pra-memilih paket
  perbaruiRingkasan();
})();
tawarkanOrderLama();
