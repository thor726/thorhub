/**
 * bg.js — Latar belakang bertema THORHUB.
 *
 * KONSEP
 *   "Thor" + "Hub", diterjemahkan ke elemen visual yang halus (bukan ramai):
 *   • HUB   — inti bercahaya dengan cincin & jari-jari (spoke) ke simpul-simpul
 *             di sekelilingnya: gambaran satu gateway yang menghubungkan banyak
 *             model/provider. Berputar sangat pelan.
 *   • THOR  — dua kilat (petir) angular berwarna lime dengan efek glow & kedip
 *             halus, mengingatkan pada Mjölnir/thor.
 *   • RUNE  — deret takik angular di lingkaran luar (nuansa nordik/teknologi).
 *
 * MENGAPA DIPISAH KE BERKAS SENDIRI
 *   Sebelumnya blok SVG latar disalin UTUH di 7 halaman (7 duplikat). Kini
 *   halaman cukup memuat <script src="/bg.js"></script> dan latar dipasang
 *   otomatis — satu sumber kebenaran, ubah sekali berlaku ke semua halaman.
 *
 * Skrip dijalankan sinkron (tanpa defer) dan menyisipkan SVG sebagai anak
 * PERTAMA <body>, sehingga tidak ada kedipan latar (FOUC) saat halaman memuat.
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var CX = 720; // pusat hub (dalam koordinat viewBox 1440×900)
  var CY = 320;

  /** Deret takik "rune" di lingkaran luar hub. */
  function buatRune() {
    var out = "";
    var N = 48;
    for (var i = 0; i < N; i++) {
      if (i % 4 === 0) continue; // beri jeda agar terlihat seperti sandi, bukan garis penuh
      var a = (360 / N) * i - 90;
      var rad = (a * Math.PI) / 180;
      var r1 = 296;
      // panjang takik bergantian → irama visual
      var r2 = 296 + (i % 2 === 0 ? 14 : 8);
      var x1 = CX + r1 * Math.cos(rad), y1 = CY + r1 * Math.sin(rad);
      var x2 = CX + r2 * Math.cos(rad), y2 = CY + r2 * Math.sin(rad);
      out += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
             '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
    }
    return out;
  }

  /** Jari-jari (spoke) + simpul (node) mengelilingi hub. */
  function buatSpokes() {
    var garis = "", simpul = "";
    var N = 12;
    for (var i = 0; i < N; i++) {
      var a = (360 / N) * i - 90;
      var rad = (a * Math.PI) / 180;
      var x1 = CX + 120 * Math.cos(rad), y1 = CY + 120 * Math.sin(rad);
      var x2 = CX + 268 * Math.cos(rad), y2 = CY + 268 * Math.sin(rad);
      garis += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
               '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
      simpul += '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="3.4"/>';
    }
    return { garis: garis, simpul: simpul };
  }

  /** Susun seluruh SVG latar. */
  function buatSvg() {
    var sp = buatSpokes();
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "cc-bg-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("viewBox", "0 0 1440 900");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("xmlns", SVG_NS);

    svg.innerHTML =
      // Hanya gradien inti yang dipakai di SVG; glow kilat & pendar ditangani CSS
      // (drop-shadow / blur) supaya tidak ada <defs> yang menganggur.
      // Warna memakai hex literal (bukan var()) karena var() di atribut
      // presentasi SVG kurang andal di sebagian browser; warna lime brand ini
      // tetap (#a3e635) sehingga tampak konsisten.
      '<defs>' +
        '<radialGradient id="ccbg-core">' +
          '<stop stop-color="#a3e635" stop-opacity=".16"/>' +
          '<stop offset="1" stop-color="#a3e635" stop-opacity="0"/>' +
        '</radialGradient>' +
      '</defs>' +

      // Cahaya inti dari atas
      '<ellipse class="ccbg-coreglow" cx="760" cy="40" rx="720" ry="340" fill="url(#ccbg-core)"/>' +

      // HUB
      '<g transform="translate(' + CX + ' ' + CY + ')">' +
        '<g class="ccbg-hub">' +
          '<circle class="ccbg-ring" r="120"/>' +
          '<circle class="ccbg-ring ccbg-dash" r="190"/>' +
          '<circle class="ccbg-ring" r="268"/>' +
          '<g class="ccbg-spokes">' + sp.garis + '</g>' +
          '<g class="ccbg-nodes">' + sp.simpul + '</g>' +
        '</g>' +
        '<g class="ccbg-runes">' + buatRune() + '</g>' +
      '</g>' +

      // KILAT (Thor) — dua jalur utama + cabang. Glow dibuat dengan duplikat berfilter.
      '<g class="ccbg-bolts">' +
        '<path class="ccbg-bolt" d="M286 -40 L344 158 L286 180 L392 438 L330 460 L458 716"/>' +
        '<path class="ccbg-bolt ccbg-bolt-fork" d="M344 158 L438 232 L392 252 L470 352"/>' +
        '<path class="ccbg-bolt ccbg-bolt-b" d="M1176 -20 L1118 168 L1184 194 L1046 470 L1116 494 L986 782"/>' +
        '<path class="ccbg-bolt ccbg-bolt-fork ccbg-bolt-b" d="M1118 168 L1020 246 L1066 268 L982 372"/>' +
      '</g>' +
      '<g class="ccbg-halo" aria-hidden="true">' +
        '<path class="ccbg-bolt" d="M286 -40 L344 158 L286 180 L392 438 L330 460 L458 716"/>' +
        '<path class="ccbg-bolt ccbg-bolt-b" d="M1176 -20 L1118 168 L1184 194 L1046 470 L1116 494 L986 782"/>' +
      '</g>';

    return svg;
  }

  function pasang() {
    if (document.querySelector(".cc-bg-svg")) return; // sudah ada
    var svg = buatSvg();
    // Sisipkan sebagai anak PERTAMA body agar berada di belakang seluruh konten.
    document.body.insertBefore(svg, document.body.firstChild);
  }

  if (document.body) pasang();
  else document.addEventListener("DOMContentLoaded", pasang);
})();
