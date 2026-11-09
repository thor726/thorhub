/**
 * nav.js — Dua tugas kecil yang dipakai SEMUA halaman:
 * 1. Aksesibilitas: wilayah gulir (tabel lebar / blok kode) menerima fokus
 *    keyboard (WCAG 2.1 — axe: scrollable-region-focusable).
 * 2. Toggle menu hamburger untuk navbar adaptif (mobile).
 * Tidak menyentuh logika halaman lain; murni UI navigasi.
 */
(function () {
  /* ---------- 1. Wilayah gulir bisa difokuskan keyboard ---------- */
  function pasangTabindexWilayahGulir(root) {
    (root || document)
      .querySelectorAll(".table-scroll, pre")
      .forEach((el) => {
        // Hanya yang benar-benar bisa menggulir, dan belum punya tabindex
        const bisaGulir = el.scrollWidth > el.clientWidth + 1;
        if (bisaGulir && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      });
  }
  pasangTabindexWilayahGulir(document);
  // Pemicu ulang: (a) DOM berubah — tabel/blok kode dirender ulang dinamis;
  // (b) atribut class berubah — tab dibuka (panel sebelumnya display:none,
  //     scrollWidth masih 0 saat pemeriksaan pertama);
  // (c) klik — cara paling umum berpindah tampilan. Semua dibatasi via rAF.
  if (window.MutationObserver) {
    let dijadwalkan = false;
    const jadwalkan = function () {
      if (dijadwalkan) return;
      dijadwalkan = true;
      requestAnimationFrame(function () {
        dijadwalkan = false;
        pasangTabindexWilayahGulir(document);
      });
    };
    new MutationObserver(jadwalkan).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    document.addEventListener("click", jadwalkan, true);
  }
  // Ukuran bisa berubah (resize/font load) — periksa ulang sekali lagi.
  window.addEventListener("load", function () {
    pasangTabindexWilayahGulir(document);
  });

  /* ---------- 2. Toggle menu hamburger ---------- */
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".topbar nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", function () {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Tutup menu" : "Buka menu");
  });

  // Tutup saat klik luar
  document.addEventListener("click", function (e) {
    if (!nav.classList.contains("open")) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  });

  // Tutup saat link diklik (navigasi)
  nav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  // Reset saat resize ke desktop
  window.addEventListener("resize", function () {
    if (window.innerWidth > 640) {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
})();
