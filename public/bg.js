/**
 * bg.js — Latar belakang bertema THORHUB.
 *
 * KONSEP
 *   "Thor" + "Hub", diterjemahkan ke elemen visual halus yang TIDAK mengganggu:
 *   • HUB   — "matahari terbit" dari tepi BAWAH: cincin konsentris + jari-jari
 *             ke simpul-simpul. Ditaruh di bawah karena area hero (teks kiri +
 *             orbit vendor kanan) ada di atas — versi sebelumnya menaruh hub di
 *             tengah-atas sehingga cincinnya bertabrakan dengan orbit.
 *   • THOR  — dua kilat angular di TEPI kiri & kanan (paruh bawah), jauh dari
 *             zona orbit, dengan kedip halus.
 *   • RUNE  — takik angular di lingkaran terluar hub (nuansa nordik/teknologi).
 *
 * ATURAN TATA LETAK (hasil pengukuran di 1280×900):
 *   Zona hero  : sekitar viewBox y 0–600, x 200–1210 (teks + orbit vendor).
 *   Latar hanya menaruh elemen kuat di y > 620 (bawah) dan x < 210 / x > 1230
 *   (margin tepi) supaya tidak menabrak konten.
 *
 * MENGAPA DIPISAH KE BERKAS SENDIRI
 *   Dulu blok SVG latar disalin UTUH di 7 halaman (7 duplikat). Kini halaman
 *   cukup memuat <script src="/bg.js"></script> — satu sumber kebenaran.
 *
 * Skrip dijalankan sinkron dan menyisipkan SVG sebagai anak PERTAMA <body>,
 * sehingga tidak ada kedipan latar (FOUC).
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  // Pusat HUB tepat di tepi BAWAH viewBox (900) → hanya busur atas hub yang
  // terlihat, seperti "horizon" matahari terbit.
  //
  // Seluruh elemen struktural (hub + kilat) sengaja dikurung dalam SATU "pita
  // aman" di BAWAH: y >~ 690 dan x ~440–1000. Dengan begitu, tak peduli seberapa
  // pendek layarnya, latar tidak akan menabrak zona hero (yang ada di atas).
  // Radius hub juga dibuat kecil agar busur atasnya tetap rendah.
  var HX = 720;
  var HY = 900;

  // Radius hub sengaja kecil supaya busur atasnya tetap rendah di layar pendek.
  var R1 = 62;   // cincin dalam
  var R2 = 104;  // cincin putus-putus
  var R3 = 140;  // cincin luar + dasar jari-jari
  var R_RUNE = 168;

  /** Deret takik "rune" di lingkaran terluar hub. */
  function buatRune() {
    var out = "";
    var N = 40;
    for (var i = 0; i < N; i++) {
      if (i % 4 === 0) continue; // jeda → terlihat seperti sandi, bukan garis penuh
      var a = (360 / N) * i - 90;
      var rad = (a * Math.PI) / 180;
      var r1 = R_RUNE;
      var r2 = R_RUNE + (i % 2 === 0 ? 9 : 5);
      out += '<line x1="' + (HX + r1 * Math.cos(rad)).toFixed(1) +
             '" y1="' + (HY + r1 * Math.sin(rad)).toFixed(1) +
             '" x2="' + (HX + r2 * Math.cos(rad)).toFixed(1) +
             '" y2="' + (HY + r2 * Math.sin(rad)).toFixed(1) + '"/>';
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
      var x1 = HX + 74 * Math.cos(rad), y1 = HY + 74 * Math.sin(rad);
      var x2 = HX + 128 * Math.cos(rad), y2 = HY + 128 * Math.sin(rad);
      garis += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
               '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
      simpul += '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="2.6"/>';
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
      // Hanya gradien yang benar-benar dipakai; glow kilat ditangani CSS.
      // Warna hex literal (var() di atribut SVG kurang andal di sebagian browser).
      '<defs>' +
        '<radialGradient id="ccbg-core">' +
          '<stop stop-color="#a3e635" stop-opacity=".14"/>' +
          '<stop offset="1" stop-color="#a3e635" stop-opacity="0"/>' +
        '</radialGradient>' +
      '</defs>' +

      // Cahaya inti di tepi atas (sangat samar)
      '<ellipse class="ccbg-coreglow" cx="720" cy="-60" rx="760" ry="320" fill="url(#ccbg-core)"/>' +

      // HUB — "matahari terbit" dari tepi bawah
      '<g transform="translate(' + HX + ' ' + HY + ')">' +
        '<g class="ccbg-hub">' +
          '<circle class="ccbg-ring" r="' + R1 + '"/>' +
          '<circle class="ccbg-ring ccbg-dash" r="' + R2 + '"/>' +
          '<circle class="ccbg-ring" r="' + R3 + '"/>' +
          '<g class="ccbg-spokes">' + sp.garis + '</g>' +
          '<g class="ccbg-nodes">' + sp.simpul + '</g>' +
        '</g>' +
        '<g class="ccbg-runes">' + buatRune() + '</g>' +
      '</g>' +

      // KILAT (Thor) — dipindah ke PITA BAWAH-TENGAH berdampingan dengan hub
      // (y >~ 690, x ~455 & ~985) agar tidak pernah menyentuh orbit vendor
      // (berakhir ~y=466) maupun teks hero pada layar pendek.
      // Titik awal kilat dimulai cukup rendah (y≈772) agar pada layar pendek
      // (mis. 1280×720) pun tidak menyentuh tepi bawah zona hero.
      '<g class="ccbg-bolts">' +
        '<path class="ccbg-bolt" d="M524 772 L566 836 L534 850 L590 900"/>' +
        '<path class="ccbg-bolt ccbg-bolt-fork" d="M566 836 L608 864 L586 876 L618 894"/>' +
        '<path class="ccbg-bolt" d="M916 772 L874 836 L906 850 L850 900"/>' +
        '<path class="ccbg-bolt ccbg-bolt-fork" d="M874 836 L832 864 L854 876 L822 894"/>' +
      '</g>' +
      // Halo: salinan kilat yang diburamkan (efek glow lembut)
      '<g class="ccbg-halo" aria-hidden="true">' +
        '<path class="ccbg-bolt" d="M524 772 L566 836 L534 850 L590 900"/>' +
        '<path class="ccbg-bolt" d="M916 772 L874 836 L906 850 L850 900"/>' +
      '</g>';

    return svg;
  }

  function pasang() {
    if (document.querySelector(".cc-bg-svg")) return; // sudah ada
    var svg = buatSvg();
    document.body.insertBefore(svg, document.body.firstChild);
  }

  if (document.body) pasang();
  else document.addEventListener("DOMContentLoaded", pasang);
})();
