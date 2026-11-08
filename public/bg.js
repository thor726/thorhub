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
 *   Seluruh komposisi dibuat CERMIN SEMPURNA terhadap garis tengah x = 800
 *   (paruh kiri dicerminkan ke paruh kanan), supaya tampilan terasa "di tengah"
 *   dan tidak berat sebelah:
 *     • Jaringan : simpul hanya digenerate di paruh kiri (x ≤ 720) lalu setiap
 *                  simpul dicerminkan ke x' = 1600 − x. Karena aturan penghubung
 *                  juga simetris, garis penghubungnya ikut simetris otomatis.
 *     • Halo     : ketiga busur berpusat tepat di x = 800.
 *     • Kilat    : jalur kanan adalah cerminan jalur kiri (dijaga manual, lihat
 *                  buatKilat()).
 *     • Grid     : kisi seragam 100px pada 1600px → selalu simetris.
 *   Uji otomatis test/check-bg.js MEMBUKTIKAN simetri ini (tiap simpul harus
 *   punya pasangan cermin).
 *
 * ATURAN TATA LETAK (diukur untuk viewBox 1600×1000)
 *   preserveAspectRatio "xMidYMid slice" ⇒ layar lebar memotong atas-bawah,
 *   layar sempit (HP) memotong KIRI-KANAN ke pita tengah x ≈ 535–1065. Karena
 *   itu tidak ada elemen struktural di luar pita bawah/tengah, dan pemotongan
 *   itu sendiri tetap simetris karena sumbu potongnya titik tengah.
 *   Kilat sengaja di margin tepi (x < 250 dan x > 1350) sehingga pada desktop
 *   selalu di luar kolom konten (wrap maks 1200px, mulai x ≈ 360).
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
  var W = 1600;
  var H = 1000;
  var TENGAH = W / 2; // 800 — sumbu cermin seluruh komposisi

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
   * <rect 1600×1000>, lingkaran satuan itu terentang jadi ELIPS berpusat
   * (800, 450) dengan rx = .72×1600 = 1152 dan ry = .72×1000 = 720.
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
    var t = Math.sqrt(Math.pow((x - 800) / 1152, 2) + Math.pow((y - 450) / 720, 2));
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
   * Sebar 14 titik di PARUH KIRI (sumbu x 80..720) lalu cerminkan ke paruh
   * kanan → 28 simpul yang simetris sempurna terhadap x = 800.
   *
   * Catatan jarak: tolakan minimum diperiksa terhadap SEMUA simpul yang sudah
   * ada — termasuk hasil cerminannya sendiri — supaya cerminan tidak menempel
   * pada simpul tetangga (bisa terjadi bila sebuah titik dekat garis tengah).
   */
  function buatSimpul() {
    var r = acak(20261108);
    var titik = []; // berisi { x, y, aktif, tunda }
    var putar = 0;
    var MAKS_DASAR = 14;
    var R_MIN = 138; // tolakan minimum antar simpul
    var dasar = 0;

    while (dasar < MAKS_DASAR && putar++ < 12000) {
      var x = 80 + r() * 640;              // 80 .. 720  (cermin: 880 .. 1520)
      var y = 90 + r() * (H - 200);        // 90 .. 890
      var mx = W - x;                      // cerminan terhadap x = 800

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
   * Busur halo di cakrawala BAWAH, berpusat TEPAT di x = 800 (simetris).
   * Pusatnya sengaja di bawah kanvas (y = 1180) sehingga hanya busur atas yang
   * terlihat — seperti pendar cakrawala. Ketiganya berputar pelan (satu grup).
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
   * Dua kilat ("Thor") di margin tepi bawah — jalur KANAN adalah cerminan
   * jalur KIRI terhadap x = 800 (dijaga manual, tanpa loop, supaya bentuknya
   * mudah dibaca & disesuaikan). Sengaja ditarik cukup rendah (y ≥ 620) agar
   * pada layar pendek tidak menyentuh zona hero. Disembunyikan CSS < 900px.
   */
  function buatKilat() {
    return '' +
      // KIRI (x ≈ 128–246, di luar tepi kiri kolom konten)
      '<path class="ccbg-kilat" d="M186 620 L138 762 L182 770 L128 900 L176 908 L132 1010"/>' +
      '<path class="ccbg-kilat-cabang" d="M182 770 L232 812 L204 826 L246 866"/>' +
      // KANAN — cermin tepat dari yang kiri (x' = 1600 − x)
      '<path class="ccbg-kilat" d="M1414 620 L1462 762 L1418 770 L1472 900 L1424 908 L1468 1010"/>' +
      '<path class="ccbg-kilat-cabang" d="M1418 770 L1368 812 L1396 826 L1354 866"/>';
  }

  /* ------------------------------------------------------------------ *
   *  Lapis 4b — Cahaya berkedip ("beacon")
   * ------------------------------------------------------------------ */

  /**
   * Pasangan titik cahaya yang BERKEDIP seperti lampu penanda jaringan.
   * Diletakkan simetris terhadap x = 800 (memenuhi prinsip simetri latar):
   *   kiri  (300,140) (520,300) (250,620)
   *   kanan (1300,140)(1080,300)(1350,620)
   * Tiap titik memakai jeda animasi berbeda supaya tidak berkedip serempak
   * (efek kedip yang organik), tetapi pasangan cerminnya memakai jeda SAMA
   * agar kiri-kanan tetap sealun.
   *
   * TIDAK ada variabel warna di sini — warna & opasitas diatur di CSS lewat
   * kelas .ccbg-lampu agar bisa disetel tanpa menyentuh geometri.
   */
  function buatKedip() {
    var pola = [
      { x: 300, y: 140, tunda: "0s" },
      { x: 520, y: 300, tunda: "1.1s" },
      { x: 250, y: 620, tunda: "2.3s" },
    ];
    var isi = "";
    for (var i = 0; i < pola.length; i++) {
      var p = pola[i];
      var mx = W - p.x; // cermin terhadap x = 800 (otomatis simetris)
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
