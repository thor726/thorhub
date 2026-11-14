/**
 * muncul.js — PRA-RENDER (BUFFER VIEWPORT) untuk animasi "muncul".
 *
 * MASALAH YANG DIPERBAIKI
 *   Sebelumnya .card, anak .stagger, dan baris .stagger-rows memakai animasi
 *   entrance (`riseIn` / `fadeUp` / `fadeIn`) TANPA SYARAT. Artinya SEMUA
 *   elemen — termasuk yang berada jauh di bawah layar — sudah beranimasi sejak
 *   halaman dimuat. Ketika pengguna menggulir dan elemen itu masuk ke area
 *   pandang, browser baru menyadari elemen itu perlu DIKOMPOSIT/DICAT untuk
 *   pertama kali (layer-nya belum siap) → satu frame berat (drop frame).
 *   Terukur di /docs @1440px: 9 frame > 33ms, p95 34.6ms, frame terburuk 48ms.
 *   Mematikan animasi entrance itu membuat frame berat turun ke 1.
 *
 * SOLUSI (buffer / pre-render)
 *   Animasi entrance tidak lagi menempel di CSS. Titik-titik "muncul" diurus di
 *   sini dengan IntersectionObserver ber-`rootMargin` BESAR (400px), sehingga
 *   elemen mulai dianimasikan saat masih 400px DI LUAR layar — sebelum pengguna
 *   benar-benar melihatnya. Saat elemen tiba di tepi layar, animasinya sudah
 *   selesai dan layer GPU-nya sudah "panas" → tidak ada frame berat.
 *
 * PRINSIP AMAN (tidak boleh menyembunyikan konten)
 *   • Yang DIHIDE hanya elemen yang berada > 400px di bawah layar (jadi tidak
 *     terlihat); elemen yang sudah tampak TIDAK disentuh sama sekali.
 *   • Hiding dilakukan lewat class `opacity: 0`, BUKAN `display:none` /
 *     `content-visibility` / penghapusan DOM — jadi tidak ada re-layout atau
 *     render ulang mendadak saat kembali terlihat (sesuai kaidah prompt).
 *   • Ada jaring pengaman (event `load`, `pageshow`, dan timer 10 detik) yang
 *     memaksa semua elemen tampil mana pun keadaannya, supaya tidak ada konten
 *     yang "terjebak" tak terlihat bila observer gagal.
 *   • Bila browser tidak mendukung IntersectionObserver atau JS mati, tidak ada
 *     yang disembunyikan — konten langsung terlihat seperti biasa.
 *
 * Elemen dinamis (mis. tabel yang dirender portal.js/admin.js sesudah fetch)
 * juga tertangkap lewat MutationObserver, jadi tidak ada yang terlewat.
 */
(function () {
  "use strict";

  // Sasaran yang tadinya dianimasikan tanpa syarat di CSS.
  var PILIH = ".card, .stagger > *, .stagger-rows tbody tr";
  var BUFFER = 400; // px jarak pra-render (buffer) dari tepi viewport
  var MODE = "munculDipantau";

  function didukung() {
    return typeof IntersectionObserver === "function";
  }

  // Elemen di dalam modal/panel tersembunyi jangan diutak-atik: modal memang
  // display:none lalu dibuka — biarkan tampil apa adanya.
  function lewati(el) {
    return el.closest(".modal") !== null || el.classList.contains("hidden");
  }

  /* ------------------------------------------------------------------ *
   *  Pengungkapan
   * ------------------------------------------------------------------ */

  function ungkap(el) {
    el.classList.remove("pra-render");
    if (el.classList.contains("masuk-jalan") || el.classList.contains("masuk-selesai")) return;
    el.classList.add("masuk-jalan");
    el.addEventListener("animationend", function selesai() {
      el.classList.remove("masuk-jalan");
      el.classList.add("masuk-selesai");
      el.removeEventListener("animationend", selesai);
    });
  }

  var io = didukung()
    ? new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            var el = entries[i].target;
            io.unobserve(el);
            ungkap(el);
          }
        }
      }, { rootMargin: BUFFER + "px 0px", threshold: 0 })
    : null;

  /* ------------------------------------------------------------------ *
   *  Penjadwalan tiap elemen
   * ------------------------------------------------------------------ */

  function jedaBerjenjang(el) {
    var p = el.parentElement;
    if (!p) return 0;
    if (p.classList.contains("stagger")) {
      var i = Array.prototype.indexOf.call(p.children, el);
      return 0.02 + Math.min(i < 0 ? 0 : i, 7) * 0.03;
    }
    if (el.closest(".stagger-rows")) {
      var j = Array.prototype.indexOf.call(p.children, el);
      el.style.animationDuration = ".25s";
      return 0.01 + Math.min(j < 0 ? 0 : j, 7) * 0.02;
    }
    return 0;
  }

  function siapkan(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.hasAttribute(MODE) || lewati(el)) return;
    if (el.classList.contains("masuk-jalan") || el.classList.contains("masuk-selesai")) return;
    el.setAttribute(MODE, "1");

    if (!io) { ungkap(el); return; } // tanpa dukungan IO: langsung tampil

    var jeda = jedaBerjenjang(el);
    if (jeda > 0) el.style.animationDelay = jeda.toFixed(2) + "s";

    var r = el.getBoundingClientRect();
    // Hanya elemen yang MASIH jauh di bawah layar yang disembunyikan lalu
    // ditunggu. Elemen yang sudah (hampir) terlihat dibiarkan apa adanya.
    if (r.top > window.innerHeight + BUFFER) {
      el.classList.add("pra-render");
      io.observe(el);
    } else {
      el.classList.add("masuk-selesai"); // di atas layar: tak perlu animasi masuk
    }
  }

  function pindai(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(PILIH)) siapkan(root);
    if (root.querySelectorAll) {
      var daftar = root.querySelectorAll(PILIH);
      for (var i = 0; i < daftar.length; i++) siapkan(daftar[i]);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Jaring pengaman
   * ------------------------------------------------------------------ */

  function ungkapSemua() {
    var tersisa = document.querySelectorAll(".pra-render");
    for (var i = 0; i < tersisa.length; i++) ungkap(tersisa[i]);
  }

  /* ------------------------------------------------------------------ *
   *  Inisialisasi
   * ------------------------------------------------------------------ */

  var sudah = false;
  function mulai() {
    if (sudah) return;
    sudah = true;

    pindai(document.body || document.documentElement);

    // Elemen yang dibuat belakangan (tabel hasil fetch, dsb.)
    if (typeof MutationObserver === "function") {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var baru = muts[i].addedNodes;
          for (var j = 0; j < baru.length; j++) pindai(baru[j]);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    // Jaring pengaman berlapis.
    window.addEventListener("load", function () { setTimeout(ungkapSemua, 2500); });
    window.addEventListener("pageshow", ungkapSemua);
    setTimeout(ungkapSemua, 10000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mulai);
  } else {
    mulai();
  }
})();
