/**
 * bg.js — Latar belakang bertema THORHUB.
 *
 * KONSEP — "infrastruktur jaringan"
 *   Latar kali ini BUKAN ornamen besar di tengah layar, melainkan tekstur
 *   ambient yang menempel di belakang konten. Tema ThorHub diterjemahkan jadi
 *   empat lapis, dari paling belakang ke depan:
 *
 *   1. CAHAYA   — pendar lime halus di tepi atas (sumber cahaya) dan di tepi
 *                 bawah (lantai). Memberi kedalaman tanpa bentuk yang jelas.
 *   2. GRID     — kisi 100px dengan garis utama 400px. Membaca "infrastruktur
 *                 / gateway". Dipudarkan ke tepi lewat <mask> radial supaya
 *                 tidak berhenti mendadak di pinggir layar.
 *   3. JARINGAN — simpul-simpul ("HUB") yang dihubungkan garis bila saling
 *                 berdekatan; tiap simpul ke-5 berdenyut. Ini metafora katalog
 *                 vendor: banyak titik, satu jaringan. Titiknya deterministik
 *                 (benih tetap) supaya tampilan sama setiap kali dimuat.
 *   4. KILAT    — dua kilat ramping di margin KIRI & KANAN bawah (identitas
 *                 "Thor"), plus busur halo putus-putus di cakrawala bawah.
 *
 * ATURAN TATA LETAK (diukur untuk viewBox 1600×1000)
 *   • preserveAspectRatio "xMidYMid slice" ⇒ layar lebar memotong atas-bawah,
 *     layar sempit (HP) memotong KIRI-KANAN ke pita tengah x ≈ 535–1065.
 *     Karena itu tak ada elemen struktural di luar pita bawah/tengah.
 *   • Kilat sengaja ditaruh di margin tepi (x < 250 dan x > 1350) sehingga pada
 *     desktop selalu berada di luar kolom konten (wrap maks 1200px, mulai x≈360).
 *   • Grid + jaringan opacity-nya sangat rendah, jadi aman berada di bawah teks.
 *
 * MENGAPA DIPISAH KE BERKAS SENDIRI
 *   Satu sumber kebenaran: halaman cukup memuat <script src="/bg.js"></script>.
 *   SVG disisipkan sebagai anak PERTAMA <body> dan skrip dijalankan sinkron
 *   (tanpa defer) agar tidak ada kedipan latar (FOUC).
 */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  // Kanvas logis latar. Semua koordinat di bawah memakai satuan ini.
  var W = 1600;
  var H = 1000;

  /* ------------------------------------------------------------------ *
   *  Utilitas
   * ------------------------------------------------------------------ */

  /**
   * PRNG linear-congruential sederhana. Dipakai agar sebaran simpul jaringan
   * SAMA setiap halaman dimuat (bukan acak ulang tiap refresh) — variasi yang
   * berubah-ubah tiap refresh terasa gelisah, terutama saat pindah halaman.
   */
  function acak(benih) {
    var s = benih >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   *  Lapis 2 — Grid
   * ------------------------------------------------------------------ */

  /** Kisi 100px + garis aksen tiap 400px (nuansa "blueprint"). */
  function buatGrid() {
    var isi = "";
    var x, y;
    for (x = 0; x <= W; x += 100) {
      isi += '<line class="' + (x % 400 === 0 ? "ccbg-garis-utama" : "ccbg-garis") +
             '" x1="' + x + '" y1="0" x2="' + x + '" y2="' + H + '"/>';
    }
    for (y = 0; y <= H; y += 100) {
      isi += '<line class="' + (y % 400 === 0 ? "ccbg-garis-utama" : "ccbg-garis") +
             '" x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '"/>';
    }
    return isi;
  }

  /* ------------------------------------------------------------------ *
   *  Lapis 3 — Jaringan simpul ("Hub")
   * ------------------------------------------------------------------ */

  /**
   * Sebar 30 titik dengan tolakan minimum 92px supaya tidak menggumpal.
   * Sampel ditolak (rejection sampling) — sederhana dan hasilnya konsisten.
   */
  function buatSimpul() {
    var r = acak(20261108);
    var titik = [];
    var putar = 0;
    while (titik.length < 30 && putar++ < 5000) {
      var x = 60 + r() * (W - 120);
      var y = 80 + r() * (H - 150);
      var bebas = true;
      for (var i = 0; i < titik.length; i++) {
        var dx = titik[i][0] - x;
        var dy = titik[i][1] - y;
        if (dx * dx + dy * dy < 92 * 92) { bebas = false; break; }
      }
      if (bebas) titik.push([Math.round(x), Math.round(y)]);
    }
    return titik;
  }

  /** Garis penghubung antar simpul berdekatan + bulatan simpulnya. */
  function buatJaringan(titik) {
    var garis = "";
    var simpul = "";
    var MAKS = 250; // ambang jarak penghubung

    for (var i = 0; i < titik.length; i++) {
      for (var j = i + 1; j < titik.length; j++) {
        var dx = titik[j][0] - titik[i][0];
        var dy = titik[j][1] - titik[i][1];
        if (dx * dx + dy * dy <= MAKS * MAKS) {
          garis += '<line x1="' + titik[i][0] + '" y1="' + titik[i][1] +
                   '" x2="' + titik[j][0] + '" y2="' + titik[j][1] + '"/>';
        }
      }

      // Tiap simpul ke-5 jadi simpul "aktif" yang berdenyut, dengan jeda
      // bertingkat (animation-delay) supaya denyutnya mengalir, bukan serempak.
      var aktif = i % 5 === 0;
      simpul += '<circle class="ccbg-simpul' + (aktif ? " ccbg-denyut" : "") +
                '" cx="' + titik[i][0] + '" cy="' + titik[i][1] + '" r="' +
                (aktif ? 3 : 1.7) + '"' +
                (aktif ? ' style="animation-delay:' + (i * 0.6).toFixed(1) + 's"' : "") +
                '/>';
    }
    return { garis: garis, simpul: simpul };
  }

  /* ------------------------------------------------------------------ *
   *  Lapis 4 — Halo & kilat
   * ------------------------------------------------------------------ */

  /**
   * Busur halo di cakrawala BAWAH. Pusatnya sengaja di bawah kanvas (y=1180)
   * sehingga hanya busur atas yang terlihat — seperti pendar cakrawala.
   * Ketiganya berputar sangat pelan (satu grup, satu animasi).
   */
  function buatHalo() {
    var isi = "";
    var radius = [380, 470, 560];
    for (var i = 0; i < radius.length; i++) {
      isi += '<circle class="ccbg-halo-arc ccbg-halo-' + (i + 1) +
             '" cx="800" cy="1180" r="' + radius[i] + '"/>';
    }
    return isi;
  }

  /**
   * Dua kilat ("Thor") di margin tepi bawah. Bentuk zig-zag sengaja ditarik
   * cukup rendah (y ≥ 620) agar pada layar pendek tidak menyentuh zona hero.
   * Elemen ini disembunyikan CSS pada layar < 900px.
   */
  function buatKilat() {
    return '' +
      // KIRI (x ≈ 128–246, di luar tepi kiri kolom konten)
      '<path class="ccbg-kilat" d="M186 620 L138 762 L182 770 L128 900 L176 908 L132 1010"/>' +
      '<path class="ccbg-kilat-cabang" d="M182 770 L232 812 L204 826 L246 866"/>' +
      // KANAN (cermin dari yang kiri, x ≈ 1354–1472)
      '<path class="ccbg-kilat" d="M1414 620 L1462 762 L1418 770 L1472 900 L1424 908 L1468 1010"/>' +
      '<path class="ccbg-kilat-cabang" d="M1418 770 L1368 812 L1396 826 L1354 866"/>';
  }

  /* ------------------------------------------------------------------ *
   *  Perakitan SVG
   * ------------------------------------------------------------------ */

  function buatSvg() {
    var titik = buatSimpul();
    var jaring = buatJaringan(titik);

    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "cc-bg-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("xmlns", NS);

    // Catatan: warna di dalam <defs> memakai hex literal (var() pada atribut
    // SVG kurang andal di sebagian browser); sisanya diatur lewat kelas CSS.
    svg.innerHTML =
      "<defs>" +
        '<radialGradient id="ccbg-cahaya-atas" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="#a3e635" stop-opacity=".13"/>' +
          '<stop offset="1" stop-color="#a3e635" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<radialGradient id="ccbg-cahaya-bawah" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="#a3e635" stop-opacity=".10"/>' +
          '<stop offset="1" stop-color="#a3e635" stop-opacity="0"/>' +
        '</radialGradient>' +
        // Pemudar tepi: dipakai bersama oleh grid & jaringan.
        '<radialGradient id="ccbg-pudar" cx="50%" cy="45%" r="72%">' +
          '<stop offset="0" stop-color="#fff" stop-opacity="1"/>' +
          '<stop offset="60%" stop-color="#fff" stop-opacity=".5"/>' +
          '<stop offset="100%" stop-color="#fff" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<mask id="ccbg-pudar-mask" maskUnits="userSpaceOnUse" ' +
              'x="0" y="0" width="' + W + '" height="' + H + '">' +
          '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#ccbg-pudar)"/>' +
        '</mask>' +
      "</defs>" +

      // --- Lapis 1: cahaya ---
      '<g class="ccbg-cahaya">' +
        '<ellipse class="ccbg-cahaya-atas" cx="800" cy="-120" rx="880" ry="420" fill="url(#ccbg-cahaya-atas)"/>' +
        '<ellipse class="ccbg-cahaya-bawah" cx="800" cy="1180" rx="900" ry="420" fill="url(#ccbg-cahaya-bawah)"/>' +
      "</g>" +

      // --- Lapis 2: grid ---
      '<g class="ccbg-grid" mask="url(#ccbg-pudar-mask)">' + buatGrid() + "</g>" +

      // --- Lapis 3: jaringan simpul ---
      '<g class="ccbg-net" mask="url(#ccbg-pudar-mask)">' +
        '<g class="ccbg-net-garis">' + jaring.garis + "</g>" +
        '<g class="ccbg-net-simpul">' + jaring.simpul + "</g>" +
      "</g>" +

      // --- Lapis 4: halo cakrawala + kilat ---
      '<g class="ccbg-halo">' + buatHalo() + "</g>" +
      '<g class="ccbg-kilat-grup">' + buatKilat() + "</g>";

    return svg;
  }

  function pasang() {
    if (document.querySelector(".cc-bg-svg")) return; // sudah terpasang
    var svg = buatSvg();
    document.body.insertBefore(svg, document.body.firstChild);
  }

  if (document.body) pasang();
  else document.addEventListener("DOMContentLoaded", pasang);
})();
