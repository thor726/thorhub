/**
 * scrollRingan.js — Kurangi beban render SELEGI pengguna menggulir.
 *
 * MASALAH YANG DIPECAHKAN
 *   Latar ThorHub (simpul denyut, halo berputar, pendar cahaya) dan orbit
 *   vendor di beranda adalah animasi TERUS-MENERUS. Selagi menggulir, browser
 *   dipaksa menghitung ulang gaya + tata letak ~61x per detik. Di ponsel beban
 *   itu memicu thermal throttling, sehingga halaman terasa makin ngelag makin
 *   lama digulir.
 *
 * CARA KERJA
 *   1. Saat ada peristiwa "scroll", pasang kelas "ber-gulir" pada <html>.
 *      CSS (lihat style.css, blok "RINGAN SAAT MENGGULIR") menjeda semua
 *      animasi latar + orbit lewat `animation-play-state: paused`.
 *   2. ~120 ms setelah gulir berhenti, kelas dilepas → animasi lanjut dari
 *      titik yang sama (tidak melompat, tidak berkedip).
 *
 * Tampilan saat halaman DIAM sama sekali tidak berubah. Skrip ini murni
 * lapisan performa; tidak menyentuh logika halaman, API, maupun elemen lain.
 *
 * Diletakkan di berkas terpisah supaya dipakai bersama oleh SEMUA halaman
 * (dimuat sebelum </body>) dan tidak mengulang kode di 7 berkas HTML.
 */
(function () {
  "use strict";

  // Hormati preferensi pengguna: bila pengguna minta animasi dikurangi,
  // animasi latar sudah dimatikan lebih awal — tak perlu skrip ini bekerja.
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch { /* matchMedia tak tersedia (browser sangat lama) — lanjut saja */ }

  var akar = document.documentElement;
  var timerJeda = 0;
  // Jeda dilepas sedikit lebih awal daripada transisi animasi biasa supaya
  // tidak ada kesan "kaku" saat gulir benar-benar berhenti.
  var JEDA_LEPAS_MS = 120;

  function sedangMenggulir() {
    if (!akar.classList.contains("ber-gulir")) akar.classList.add("ber-gulir");
    if (timerJeda) clearTimeout(timerJeda);
    timerJeda = window.setTimeout(function () {
      akar.classList.remove("ber-gulir");
      timerJeda = 0;
    }, JEDA_LEPAS_MS);
  }

  // passive: true → browser tak perlu menunggu skrip ini sebelum menggulir
  // (penting agar gulir tetap mulus di ponsel).
  window.addEventListener("scroll", sedangMenggulir, { passive: true });

  // Pengaman: bila halaman disembunyikan saat sedang menggulir (mis. pindah
  // aplikasi), pastikan kelas dilepas agar animasi tidak "beku" selamanya.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (timerJeda) { clearTimeout(timerJeda); timerJeda = 0; }
      akar.classList.remove("ber-gulir");
    }
  });
})();
