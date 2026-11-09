/**
 * bg.js — Latar belakang bertema THORHUB.
 *
 * KONSEP — "infrastruktur jaringan", SIMETRIS TERHADAP TENGAH
 *   Latar adalah tekstur ambient di belakang konten, tersusun dari empat lapis
 *   (belakang → depan):
 *
 *   1. CAHAYA   — pendar lime di tepi atas (sumber) dan tepi bawah (lantai).
 *   2. GRID     — kisi 100px dengan garis aksen 400px. Membaca "infrastruktur
 *                 / gateway". Dipudarkan ke tepi lewat <mask> radial.
 *   3. JARINGAN — simpul-simpul ("HUB") yang dihubungkan garis bila berdekatan;
 *                 tiap simpul ketiga berdenyut. Metafora katalog vendor: banyak
 *                 titik, satu jaringan.
 *   4. HALO     — tiga busur berputar di cakrawala bawah + dua kilat ("Thor")
 *                 di margin kiri & kanan.
 *
 * SIMETRI (permintaan langsung pemilik produk)
 *   Seluruh komposisi dibuat CERMIN SEMPURNA terhadap garis tengah x = 1000
 *   (paruh kiri dicerminkan ke paruh kanan), supaya tampilan terasa "di tengah"
 *   dan tidak berat sebelah:
 *     • Jaringan : simpul hanya digenerate di paruh kiri (x ≤ 900) lalu setiap
 *                  simpul dicerminkan ke x' = 2000 − x. Karena aturan penghubung
 *                  juga simetris, garis penghubungnya ikut simetris otomatis.
 *     • Halo     : ketiga busur berpusat tepat di x = 1000.
 *     • Kilat    : jalur kanan adalah cerminan jalur kiri (dijaga manual, lihat
 *                  buatKilat()).
 *     • Grid     : kisi seragam 100px pada 2000px → selalu simetris.
 *   Uji otomatis test/check-bg.js MEMBUKTIKAN simetri ini (tiap simpul harus
 *   punya pasangan cermin).
 *
 * ATURAN TATA LETAK (diukur untuk viewBox 2000×1250)
 *   preserveAspectRatio "xMidYMid slice" ⇒ layar lebar memotong atas-bawah,
 *   layar sempit (HP) memotong KIRI-KANAN ke pita tengah x ≈ 669–1331. Karena
 *   itu tidak ada elemen struktural di luar pita bawah/tengah, dan pemotongan
 *   itu sendiri tetap simetris karena sumbu potongnya titik tengah.
 *   PERKECILAN ZOOM (permintaan pemilik: "background terlalu ngezoom"):
 *   kanvas logis diperbesar 1600×1000 → 2000×1250 (faktor 1,25) TANPA
 *   mengubah ukuran elemen (kisi 100px, radius simpul, jarak penghubung).
 *   Karena slice menskalakan viewBox ke layar, hasil akhirnya seluruh pola
 *   tampak ±20% lebih kecil dan 25% lebih banyak tekstur terlihat — di
 *   desktop maupun HP. Simpul jaringan ditambah 14 → 22 pasang agar
 *   DENSITAS tetap sama (bukan jadi kosong).
 *
 * MENGAPA DIPISAH KE BERKAS SENDIRI
 *   Satu sumber kebenaran: halaman cukup memuat <script src="/bg.js"></script>.
 *   SVG disisipkan sebagai anak PERTAMA <body> dan skrip dijalankan sinkron
 *   (tanpa defer) agar tidak ada kedipan latar (FOUC).
 *
 * INTENSITAS WARNA
 *   Semua warna/opasitas diatur di public/style.css lewat variabel --cc-*, bukan
 *   di sini — supaya bisa disetel tanpa menyentuh geometri.
 */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  // Kanvas logis latar. Semua koordinat di bawah memakai satuan ini.
  var W = 2000;
  var H = 1250;
  var TENGAH = W / 2; // 1000 — sumbu cermin seluruh komposisi

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

  function jarak2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return dx * dx + dy * dy;
  }

  /**
   * pudar(x, y) — nilai pemudar tepi di sebuah titik kanvas, 0..1.
   *
   * Rumus ini SAMA PERSIS dengan <radialGradient id="ccbg-pudar"> yang dipakai
   * <mask> grup grid & jaringan: cx=50% cy=45% r=72%, stop 0→1, 60%→.55,
   * 100%→0. Karena gradientUnits-nya objectBoundingBox dan dipasang pada
   * <rect 2000×1250>, lingkaran satuan itu terentang jadi ELIPS berpusat
   * (1000, 562) dengan rx = .72×2000 = 1440 dan ry = .72×1250 = 900.
   *
   * MENGAPA DIRUMUSKAN, BUKAN DISERAHKAN KE <mask> SAJA
   *   Uji A/B terukur di Chromium (1440px): grup yang memakai <mask> SEKALIGUS
   *   berisi elemen beranimasi memaksa mask dihitung ulang setiap frame —
   *   FPS diam jatuh ke ~37. Bila simpul yang berdenyut dipindah KELUAR dari
   *   grup ber-mask dan nilai pudarnya "dipanggang" (baked) ke atribut
   *   fill-opacity, FPS naik kembali ke ~60 dengan tampilan praktis identik
   *   (opasitas total = pudar(x,y) × opasitas kelas, sama seperti sebelumnya).
   *   Simpul DIAM tetap di dalam grup ber-mask: grup ber-mask TANPA animasi
   *   terbukti tidak membebani.
   */
  var PUDAR_STOP = [[0, 1], [0.6, 0.55], [1, 0]];
  function pudar(x, y) {
    var t = Math.sqrt(Math.pow((x - W / 2) / (0.72 * W), 2) + Math.pow((y - 0.45 * H) / (0.72 * H), 2));
    for (var i = 1; i < PUDAR_STOP.length; i++) {
      var t0 = PUDAR_STOP[i - 1][0], a0 = PUDAR_STOP[i - 1][1];
      var t1 = PUDAR_STOP[i][0], a1 = PUDAR_STOP[i][1];
      if (t <= t1) return a0 + (a1 - a0) * ((t - t0) / (t1 - t0));
    }
    return 0;
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
   *  Lapis 3 — Jaringan simpul ("Hub"), simetris cermin
   * ------------------------------------------------------------------ */

  /**
   * Sebar 22 titik di PARUH KIRI (sumbu x 100..900) lalu cerminkan ke paruh
   * kanan → 44 simpul yang simetris sempurna terhadap x = 1000.
   *
   * Jumlah dinaikkan 14 → 22 mengikuti perbesaran kanvas (1600×1000 →
   * 2000×1250) supaya DENSITAS jaringan per piksel layar tetap sama —
   * kanvas dibesarkan hanya untuk memperkecil tampilan (anti "ngezoom").
   *
   * Catatan jarak: tolakan minimum diperiksa terhadap SEMUA simpul yang sudah
   * ada — termasuk hasil cerminannya sendiri — supaya cerminan tidak menempel
   * pada simpul tetangga (bisa terjadi bila sebuah titik dekat garis tengah).
   */
  function buatSimpul() {
    var r = acak(20261108);
    var titik = []; // berisi { x, y, aktif, tunda }
    var putar = 0;
    var MAKS_DASAR = 22;
    var R_MIN = 138; // tolakan minimum antar simpul (tetap — ikut memperkecil tampilan)
    var dasar = 0;

    while (dasar < MAKS_DASAR && putar++ < 20000) {
      var x = 100 + r() * 800;             // 100 .. 900  (cermin: 1100 .. 1900)
      var y = 90 + r() * (H - 200);        // 90 .. 1140
      var mx = W - x;                      // cerminan terhadap x = 1000

      // Tolak bila terlalu dekat dengan simpul mana pun (atau cerminannya).
      var bebas = jarak2(x, y, mx, y) > R_MIN * R_MIN; // jangan menempel cerminnya
      for (var i = 0; i < titik.length && bebas; i++) {
        if (jarak2(x, y, titik[i].x, titik[i].y) < R_MIN * R_MIN) bebas = false;
      }
      if (!bebas) continue;

      // Tiap simpul dasar ke-3 menjadi simpul "aktif" (berdenyut). Penentuannya
      // dari indeks DASAR, jadi pasangan cerminnya ikut aktif → tetap simetris.
      var aktif = dasar % 3 === 0;
      var tunda = (dasar * 0.9).toFixed(1) + "s";

      titik.push({ x: Math.round(x), y: Math.round(y), aktif: aktif, tunda: tunda });
      titik.push({ x: Math.round(mx), y: Math.round(y), aktif: aktif, tunda: tunda });
      dasar++;
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
        if (jarak2(titik[i].x, titik[i].y, titik[j].x, titik[j].y) <= MAKS * MAKS) {
          garis += '<line x1="' + titik[i].x + '" y1="' + titik[i].y +
                   '" x2="' + titik[j].x + '" y2="' + titik[j].y + '"/>';
        }
      }
    }

    /* Simpul dipisah jadi DUA kelompok (alasan performa, lihat pudar()):
       • simpulDiam   → tetap di dalam grup ber-mask; ikut dipudarkan <mask>.
       • simpulDenyut → KELUAR dari grup ber-mask; nilai pudarnya dipanggang ke
         atribut fill-opacity. Tampilan sama, tetapi <mask> tak perlu dihitung
         ulang tiap frame saat simpul berdenyut.
       Kelas .ccbg-simpul-denyut tetap memuat "ccbg-denyut" agar aturan animasi
       di CSS yang sudah ada langsung berlaku (tanpa duplikasi). */
    var simpulDiam = "";
    var simpulDenyut = "";
    for (var k = 0; k < titik.length; k++) {
      var t = titik[k];
      if (t.aktif) {
        simpulDenyut += '<circle class="ccbg-simpul-denyut ccbg-denyut" cx="' + t.x + '" cy="' + t.y +
                        '" r="3.4" fill-opacity="' + pudar(t.x, t.y).toFixed(4) + '"' +
                        ' style="animation-delay:' + t.tunda + '"/>';
      } else {
        simpulDiam += '<circle class="ccbg-simpul" cx="' + t.x + '" cy="' + t.y + '" r="2"/>';
      }
    }
    return { garis: garis, simpul: simpulDiam, simpulDenyut: simpulDenyut };
  }

  /* ------------------------------------------------------------------ *
   *  Lapis 4 — Halo & kilat
   * ------------------------------------------------------------------ */

  /**
   * Busur halo di cakrawala BAWAH, berpusat TEPAT di x = 1000 (simetris).
   * Pusatnya sengaja di bawah kanvas (y = 1430) sehingga hanya busur atas yang
   * terlihat — seperti pendar cakrawala. Ketiganya berputar pelan (satu grup).
   */
  function buatHalo() {
    var isi = "";
    var radius = [475, 588, 700]; // proporsional dengan kanvas 2000×1250
    for (var i = 0; i < radius.length; i++) {
      isi += '<circle class="ccbg-halo-arc ccbg-halo-' + (i + 1) +
             '" cx="' + TENGAH + '" cy="' + (H + 180) + '" r="' + radius[i] + '"/>';
    }
    return isi;
  }

  /**
   * Dua kilat ("Thor") di margin tepi bawah — jalur KANAN adalah cerminan
   * jalur KIRI terhadap x = 1000 (dijaga manual, tanpa loop, supaya bentuknya
   * mudah dibaca & disesuaikan). Sengaja ditarik cukup rendah (y ≥ 775) agar
   * pada layar pendek tidak menyentuh zona hero. Disembunyikan CSS < 900px.
   */
  function buatKilat() {
    return '' +
      // KIRI (x ≈ 128–246, di luar tepi kiri kolom konten)
      '<path class="ccbg-kilat" d="M186 775 L138 953 L182 963 L128 1125 L176 1135 L132 1263"/>' +
      '<path class="ccbg-kilat-cabang" d="M182 963 L232 1015 L204 1033 L246 1083"/>' +
      // KANAN — cermin tepat dari yang kiri (x' = 2000 − x)
      '<path class="ccbg-kilat" d="M1814 775 L1862 953 L1818 963 L1872 1125 L1824 1135 L1868 1263"/>' +
      '<path class="ccbg-kilat-cabang" d="M1818 963 L1768 1015 L1796 1033 L1754 1083"/>';
  }

  /* ------------------------------------------------------------------ *
   *  Lapis 4b — Cahaya berkedip ("beacon")
   * ------------------------------------------------------------------ */

  /**
   * Pasangan titik cahaya yang BERKEDIP seperti lampu penanda jaringan.
   * Diletakkan simetris terhadap x = 1000 (memenuhi prinsip simetri latar):
   *   kiri  (375,175) (650,375) (312,775)
   *   kanan (1625,175)(1350,375)(1688,775)
   * Tiap titik memakai jeda animasi berbeda supaya tidak berkedip serempak
   * (efek kedip yang organik), tetapi pasangan cerminnya memakai jeda SAMA
   * agar kiri-kanan tetap sealun.
   *
   * TIDAK ada variabel warna di sini — warna & opasitas diatur di CSS lewat
   * kelas .ccbg-lampu agar bisa disetel tanpa menyentuh geometri.
   */
  function buatKedip() {
    var pola = [
      { x: 375, y: 175, tunda: "0s" },
      { x: 650, y: 375, tunda: "1.1s" },
      { x: 312, y: 775, tunda: "2.3s" },
    ];
    var isi = "";
    for (var i = 0; i < pola.length; i++) {
      var p = pola[i];
      var mx = W - p.x; // cermin terhadap x = 1000 (otomatis simetris)
      isi += '<circle class="ccbg-lampu" cx="' + p.x + '" cy="' + p.y +
             '" r="2.6" style="animation-delay:' + p.tunda + '"/>';
      isi += '<circle class="ccbg-lampu-halo" cx="' + p.x + '" cy="' + p.y +
             '" r="11" fill="url(#ccbg-lampu-pendar)" style="animation-delay:' + p.tunda + '"/>';
      isi += '<circle class="ccbg-lampu" cx="' + mx + '" cy="' + p.y +
             '" r="2.6" style="animation-delay:' + p.tunda + '"/>';
      isi += '<circle class="ccbg-lampu-halo" cx="' + mx + '" cy="' + p.y +
             '" r="11" fill="url(#ccbg-lampu-pendar)" style="animation-delay:' + p.tunda + '"/>';
    }
    return isi;
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
          '<stop offset="0" stop-color="#a3e635" stop-opacity=".22"/>' +
          '<stop offset="1" stop-color="#a3e635" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<radialGradient id="ccbg-cahaya-bawah" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="#a3e635" stop-opacity=".18"/>' +
          '<stop offset="1" stop-color="#a3e635" stop-opacity="0"/>' +
        '</radialGradient>' +
        // Pemudar tepi: dipakai bersama oleh grid & jaringan.
        '<radialGradient id="ccbg-pudar" cx="50%" cy="45%" r="72%">' +
          '<stop offset="0" stop-color="#fff" stop-opacity="1"/>' +
          '<stop offset="60%" stop-color="#fff" stop-opacity=".55"/>' +
          '<stop offset="100%" stop-color="#fff" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<mask id="ccbg-pudar-mask" maskUnits="userSpaceOnUse" ' +
              'x="0" y="0" width="' + W + '" height="' + H + '">' +
          '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#ccbg-pudar)"/>' +
        '</mask>' +
        // Pendar tiap titik "cahaya berkedip" (dipakai .ccbg-lampu-halo).
        '<radialGradient id="ccbg-lampu-pendar" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="#a3e635" stop-opacity=".55"/>' +
          '<stop offset="1" stop-color="#a3e635" stop-opacity="0"/>' +
        '</radialGradient>' +
      "</defs>" +

      // --- Lapis 1: cahaya ---
      '<g class="ccbg-cahaya">' +
        '<ellipse class="ccbg-cahaya-atas" cx="' + TENGAH + '" cy="-150" rx="1100" ry="525" fill="url(#ccbg-cahaya-atas)"/>' +
        '<ellipse class="ccbg-cahaya-bawah" cx="' + TENGAH + '" cy="' + (H + 180) + '" rx="1125" ry="525" fill="url(#ccbg-cahaya-bawah)"/>' +
      "</g>" +

      // --- Lapis 2: grid ---
      '<g class="ccbg-grid" mask="url(#ccbg-pudar-mask)">' + buatGrid() + "</g>" +

      // --- Lapis 3: jaringan simpul ---
      '<g class="ccbg-net" mask="url(#ccbg-pudar-mask)">' +
        '<g class="ccbg-net-garis">' + jaring.garis + "</g>" +
        '<g class="ccbg-net-simpul">' + jaring.simpul + "</g>" +
      "</g>" +
      /* Simpul yang BERDENYUT sengaja di LUAR grup ber-mask (alasan performa,
         lihat pudar()) — nilai pemudarnya sudah dipanggang ke fill-opacity. */
      '<g class="ccbg-net-denyut">' + jaring.simpulDenyut + "</g>" +

      // --- Lapis 4: halo cakrawala + cahaya berkedip + kilat ---
      '<g class="ccbg-halo">' + buatHalo() + "</g>" +
      '<g class="ccbg-lampu-grup">' + buatKedip() + "</g>" +
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
