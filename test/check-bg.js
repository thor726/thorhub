/**
 * Uji bg.js di Node tanpa browser — SEKARANG untuk KANVAS ADAPTIF.
 *
 * bg.js memilih ukuran kanvas berdasarkan layar (lihat komentar di bg.js).
 * Uji ini menjalankan bg.js pada 4 UKURAN LAYAR representatif (HP, laptop,
 * desktop 1920, ultrawide 2560) lewat global.CC_UJI_LAYAR — jalur yang sama
 * persis dengan produksi — lalu memeriksa setiap hasil:
 *   • viewBox benar & kelipatan 400 (grid menyentuh tepi simetris)
 *   • skala slice ≤ 0.56 → grid 100px kanvas tampil ≤ ±56px di layar (anti "ngezoom")
 *   • simetri cermin sempurna terhadap x = W/2 (simpul, penghubung, halo,
 *     kilat, grid) — permintaan eksplisit pemilik produk
 *   • tidak ada NaN/undefined, id <defs> ↔ url(#...) saling terhubung,
 *     simpul berdenyut di luar grup ber-mask (performa FPS).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const kode = fs.readFileSync(path.join(__dirname, "..", "public", "bg.js"), "utf8");

let totalErr = 0;

/* 4 ukuran layar representatif + skala target yang dijanjikan bg.js. */
const LAYAR = [
  ["HP 390×844", 390, 844],
  ["laptop 1440×900", 1440, 900],
  ["desktop 1920×1080", 1920, 1080],
  ["ultrawide 2560×1440", 2560, 1440],
];

function jalankanBgmjs(vw, vh) {
  let svgDibuat = null;
  function buatEl(ns, tag) {
    const el = {
      tagName: tag,
      attrs: {},
      innerHTML: "",
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
    };
    if (tag === "svg") svgDibuat = el;
    return el;
  }
  const body = {
    firstChild: { dummy: true },
    insertBefore(node) { this.anak = node; },
  };
  const doc = {
    body,
    documentElement: { clientWidth: vw, clientHeight: vh },
    createElementNS: buatEl,
    querySelector: () => null,
    addEventListener: () => {},
  };
  const ctx = vm.createContext({
    document: doc, window: { innerWidth: vw, innerHeight: vh },
    Math, console, CC_UJI_LAYAR: [vw, vh],
  });
  vm.runInContext(kode, ctx, { filename: "bg.js" });
  return { svg: svgDibuat, body, kanvas: ctx.CC_UJI_KANVAS };
}

function ujiSatuLayar([nama, vw, vh]) {
  console.log(`\n========== ${nama} ==========`);
  let err = 0;
  const cek = (label, ok, info = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${info ? "  (" + info + ")" : ""}`);
    if (!ok) err++;
  };

  let svgDibuat, body, kanvas;
  try {
    ({ svg: svgDibuat, body, kanvas } = jalankanBgmjs(vw, vh));
  } catch (e) {
    cek("bg.js berjalan tanpa error", false, e.message);
    totalErr += err;
    return;
  }

  const W = kanvas[0], H = kanvas[1], TENGAH = W / 2;
  console.log(`  kanvas terpilih: ${W}×${H}`);

  cek("SVG terbentuk", !!svgDibuat);
  cek("disisipkan sebagai anak pertama body", body.anak === svgDibuat);

  const svg = svgDibuat.innerHTML;
  const attr = svgDibuat.attrs;

  cek("class = cc-bg-svg", attr.class === "cc-bg-svg");
  cek("aria-hidden = true", attr["aria-hidden"] === "true");
  cek(`viewBox = "0 0 ${W} ${H}"`, attr.viewBox === `0 0 ${W} ${H}`, attr.viewBox);
  cek("kanvas kelipatan 400 (grid simetris menyentuh tepi)", W % 400 === 0 && H % 400 === 0, `${W % 400}/${H % 400}`);
  cek("preserveAspectRatio = slice", attr.preserveAspectRatio === "xMidYMid slice");

  /* ANTI-ZOOM: skala slice = max(elemW/W, elemH/H), elem = layar + 80 buffer.
     Target bg.js 0.55 → grid 100px kanvas tampil ≤ ±56px di layar mana pun. */
  const skala = Math.max((vw + 80) / W, (vh + 80) / H);
  const gridLayar = Math.round(100 * skala);
  cek("skala ≤ 0.56 (latar tidak ngezoom)", skala <= 0.56, `skala=${skala.toFixed(3)} → grid ${gridLayar}px di layar`);

  cek("tidak ada NaN", !/NaN/.test(svg));
  cek("tidak ada undefined", !/undefined/.test(svg));

  // Elemen struktural
  const hitung = (re) => (svg.match(re) || []).length;
  const garisGrid = hitung(/class="ccbg-garis/g);
  const simpul = hitung(/class="ccbg-simpul/g);
  const denyut = hitung(/ccbg-denyut/g);
  const halo = hitung(/class="ccbg-halo-arc/g);
  const kilat = hitung(/class="ccbg-kilat"/g);
  const netGaris = hitung(/<line x1=/g); // garis jaringan tanpa class

  console.log(`  grid: ${garisGrid} garis | jaringan: ${simpul} simpul, ${netGaris} penghubung`);
  cek("grid tergambar penuh ((W/100+1)+(H/100+1) garis)", garisGrid === W / 100 + H / 100 + 2, `${garisGrid} vs ${W / 100 + H / 100 + 2}`);
  cek("simpul jaringan ≥ 20", simpul >= 20, String(simpul));
  cek("ada penghubung antar simpul", netGaris > 10, String(netGaris));
  cek("simpul berdenyut ada", denyut >= 4, String(denyut));
  cek("3 busur halo", halo === 3, String(halo));
  cek("2 jalur kilat utama", kilat === 2, String(kilat));

  /* PERFORMA: simpul berdenyut harus DI LUAR grup ber-mask (alasan FPS, lihat bg.js). */
  const iMask = svg.indexOf('mask="url(#ccbg-pudar-mask)"');
  const iDenyut = svg.indexOf('class="ccbg-net-denyut"');
  const akhirGrupMask = svg.indexOf("</g>", svg.indexOf("ccbg-net-simpul"));
  cek("grup simpul denyut berada DI LUAR grup ber-mask",
    iDenyut > 0 && iDenyut > akhirGrupMask && iMask > 0, `denyut@${iDenyut} mask@${iMask} tutup@${akhirGrupMask}`);
  const jumlahDenyutLuar = (svg.slice(iDenyut).match(/class="ccbg-simpul-denyut/g) || []).length;
  cek("semua simpul denyut dikeluarkan dari mask", jumlahDenyutLuar === denyut, `${jumlahDenyutLuar} dari ${denyut}`);
  const denyutBak = (svg.match(/fill-opacity="[\d.]+"/g) || []).length;
  cek("nilai pudar simpul denyut dipanggang (fill-opacity)", denyutBak === denyut, `${denyutBak} dari ${denyut}`);

  // <defs> ↔ referensi
  const defIds = [...svg.matchAll(/id="(ccbg-[a-z-]+)"/g)].map((m) => m[1]);
  for (const id of defIds) cek(`id "${id}" dipakai`, svg.includes(`url(#${id})`));
  const urlRefs = [...svg.matchAll(/url\(#(ccbg-[a-z-]+)\)/g)].map((m) => m[1]);
  for (const u of new Set(urlRefs)) cek(`referensi url(#${u}) punya definisi`, defIds.includes(u));

  /* ============ SIMETRI CERMIN terhadap x = W/2 ============ */
  console.log(`  -- simetri cermin (sumbu x = ${TENGAH}) --`);

  const simpulRe = /<circle class="(ccbg-simpul[^"]*)" cx="(\d+)" cy="(\d+)" r="([\d.]+)"(?: fill-opacity="([\d.]+)")?(?: style="animation-delay:([\d.]+)s")?\/>/g;
  const daftarSimpul = [...svg.matchAll(simpulRe)].map((m) => ({
    kelas: m[1], x: Number(m[2]), y: Number(m[3]), r: Number(m[4]), tunda: m[5] || null,
  }));
  const kunciSimpul = (s) => `${s.x}|${s.y}|${s.kelas}|${s.r}|${s.tunda}`;
  const himpunanSimpul = new Set(daftarSimpul.map(kunciSimpul));
  const tanpaCermin = daftarSimpul.filter((s) =>
    !himpunanSimpul.has(kunciSimpul({ ...s, x: W - s.x })));
  cek(`semua ${daftarSimpul.length} simpul punya pasangan cermin`, tanpaCermin.length === 0,
    tanpaCermin.length ? `tanpa cermin: ${tanpaCermin.slice(0, 4).map((s) => s.x + "," + s.y).join(" ")}…` : "");

  const terlaluDekatTengah = daftarSimpul.filter((s) => Math.abs(s.x - TENGAH) < 40);
  cek("tidak ada simpul menempel garis tengah (< 40px)", terlaluDekatTengah.length === 0);

  const tinggiTengah = 0.45 * H; // pusat elips pemudar (cy = 45% H)
  const rataY = daftarSimpul.reduce((a, s) => a + s.y, 0) / daftarSimpul.length;
  cek("sebaran simpul seimbang atas-bawah (rata2 y ≈ 0.45H ± 12%)",
    Math.abs(rataY - tinggiTengah) <= 0.12 * H, `rata2 y = ${rataY.toFixed(0)} vs ${tinggiTengah.toFixed(0)}`);

  const xsSimpul = daftarSimpul.map((s) => s.x);
  const minX = Math.min(...xsSimpul), maxX = Math.max(...xsSimpul);
  cek("kotak jaringan simetris (minX + maxX = W)", minX + maxX === W, `${minX} + ${maxX} = ${minX + maxX}`);

  const garisNet = [...svg.matchAll(/<line x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"\/>/g)]
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
  const kunciGaris = (g) => g.join("|");
  const setGarisNet = new Set(garisNet.map(kunciGaris));
  const punyaCermin = ([a, b, c, d]) =>
    setGarisNet.has(kunciGaris([W - a, b, W - c, d])) ||
    setGarisNet.has(kunciGaris([W - c, d, W - a, b]));
  const garisTanpaCermin = garisNet.filter((g) => !punyaCermin(g));
  cek(`semua ${garisNet.length} penghubung jaringan punya pasangan cermin`,
    garisTanpaCermin.length === 0, garisTanpaCermin.length ? `${garisTanpaCermin.length} garis` : "");

  const haloRe = /<circle class="ccbg-halo-arc ccbg-halo-\d+" cx="(\d+)" cy="(\d+)" r="(\d+)"\/>/g;
  const daftarHalo = [...svg.matchAll(haloRe)].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) }));
  cek("semua busur halo berpusat di x = W/2",
    daftarHalo.length > 0 && daftarHalo.every((h) => h.cx === TENGAH),
    daftarHalo.map((h) => h.cx).join(","));

  // GUARD REGRESI: origin rotasi grup halo HARUS = pusat busur (TENGAH, H+180).
  // Dulu hardcode 800px 1180px di CSS (kanvas lama) — pada kanvas adaptif busur
  // mengembar mengelilingi titik salah dan sering keluar dari cakrawala.
  const mOrigin = svg.match(/<g class="ccbg-halo" style="transform-origin:(\d+)px (\d+)px">/);
  cek("grup halo membawa transform-origin dinamis (TENGAH, H+180)",
    !!mOrigin && Number(mOrigin[1]) === TENGAH && Number(mOrigin[2]) === H + 180,
    mOrigin ? `${mOrigin[1]},${mOrigin[2]} vs ${TENGAH},${H + 180}` : "tidak ada origin inline");

  const kilatD = [...svg.matchAll(/class="ccbg-kilat" d="([^"]+)"/g)].map((m) => m[1]);
  const titikJalur = (d) => [...d.matchAll(/[ML] ?(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (kilatD.length === 2) {
    const kiri = titikJalur(kilatD[0]);
    const kanan = titikJalur(kilatD[1]);
    const cocok = kiri.length === kanan.length &&
      kiri.every(([x, y], i) => Math.abs((W - x) - kanan[i][0]) < 0.001 && y === kanan[i][1]);
    cek("kilat kanan = cerminan tepat kilat kiri", cocok, `${kiri.length} titik per jalur`);
    const jarakKiri = TENGAH - Math.min(...kiri.map((p) => p[0]));
    const jarakKanan = Math.max(...kanan.map((p) => p[0])) - TENGAH;
    cek("jarak kilat ke garis tengah seimbang", jarakKiri === jarakKanan, `kiri ${jarakKiri} / kanan ${jarakKanan}`);
    // Kilat harus berada DI pita bawah kanvas adaptif (y0 = H−608 … H−218).
    const semuaY = kiri.map((p) => p[1]);
    cek("kilat di pita bawah kanvas (y ≥ H−620)", Math.min(...semuaY) >= H - 620, `y ${Math.min(...semuaY)}..${Math.max(...semuaY)} (H=${H})`);
  } else {
    cek("ada 2 jalur kilat untuk diperiksa simetrinya", false, String(kilatD.length));
  }

  const garisGridSemua = [...svg.matchAll(
    /<line class="ccbg-garis[^"]*" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"\/>/g)]
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
  const xsGrid = garisGridSemua.filter((g) => g[0] === g[2]).map((g) => g[0]);
  const setXGrid = new Set(xsGrid);
  cek("grid vertikal simetris (tiap x punya cermin W − x)",
    xsGrid.length > 0 && xsGrid.every((x) => setXGrid.has(W - x)), `${xsGrid.length} garis vertikal`);
  const ysGrid = garisGridSemua.filter((g) => g[1] === g[3]);
  cek("grid horizontal membentang penuh 0→W (otomatis simetris)",
    ysGrid.length > 0 && ysGrid.every((g) => g[0] === 0 && g[2] === W), `${ysGrid.length} garis horizontal`);
  cek("jumlah garis grid konsisten", garisGridSemua.length === garisGrid, `${garisGridSemua.length} vs ${garisGrid}`);

  // Lampu berkedip: pasangan cermin simetris
  const lampu = [...svg.matchAll(/class="ccbg-lampu" cx="(\d+)" cy="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const setLampu = new Set(lampu.map((p) => p.join("|")));
  const lampuTanpaCermin = lampu.filter(([x, y]) => !setLampu.has(`${W - x}|${y}`));
  cek(`semua ${lampu.length} lampu berkedip punya pasangan cermin`, lampuTanpaCermin.length === 0);

  // Koordinat dalam kanvas (toleransi 200 untuk cahaya yang sengaja keluar tepi).
  // Batas memakai max(W,H) karena kanvas potret (HP) punya H > W.
  const batas = Math.max(W, H) + 200;
  const luar = [...svg.matchAll(/(?:x|cx|y|cy|x1|x2|y1|y2)="(-?\d+(?:\.\d+)?)"/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n < -200 || n > batas);
  cek("tidak ada koordinat nyasar di luar kanvas", luar.length === 0, luar.slice(0, 5).join(","));

  totalErr += err;
}

for (const l of LAYAR) ujiSatuLayar(l);

console.log("\n=== HASIL AKHIR ===");
console.log(totalErr === 0 ? "bg.js VALID di semua ukuran layar (0 masalah)" : `${totalErr} masalah ditemukan`);
process.exit(totalErr === 0 ? 0 : 1);
