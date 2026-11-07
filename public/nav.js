/**
 * nav.js — Toggle menu hamburger untuk navbar adaptif (mobile).
 * Tidak menyentuh logika halaman lain; murni UI navigasi.
 */
(function () {
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
