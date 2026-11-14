/**
 * probe-halo.js — verifikasi kuantitatif busur halo (orbit) latar:
 * 1. Geometri & gaya terhitung (viewBox, transform-origin, stroke).
 * 2. Tangkap pita bawah viewport (deviceScaleFactor 2) lalu HITUNG piksel
 *    lime-ish via sharp — membuktikan busur benar-benar ter-render & terlihat.
 * Output: JSON per viewport { geometri, pikselLime, bbox }.
 */
const { chromium } = require("playwright");
const sharp = require("sharp");

const VIEWPORTS = [
  ["desktop-1920", 1920, 1080, 280],
  ["mobile-390", 390, 844, 240],
];

function analisisLime(buf) {
  // Piksel "lime-ish": dominan hijau, merah sedang, biru rendah (keluarga
  // #a3e635 pada alpha apa pun di atas latar gelap).
  return sharp(buf)
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      let hitung = 0;
      let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
      for (let i = 0; i < data.length; i += info.channels) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (g > 45 && g > r && r > b && g - b > 25) {
          hitung++;
          const px = (i / info.channels) % info.width;
          const py = Math.floor(i / info.channels / info.width);
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
      }
      return { pikselLime: hitung, bbox: [minX, minY, maxX, maxY] };
    });
}

(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox"] });
  for (const [nama, w, h, pita] of VIEWPORTS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
    await p.waitForSelector("svg[viewBox]");
    const geo = await p.evaluate(() => {
      const svg = document.querySelector("svg[viewBox]");
      const g = svg.querySelector(".ccbg-halo");
      const arcs = [...svg.querySelectorAll(".ccbg-halo-arc")].map((a) => ({
        r: a.getAttribute("r"),
        topPx: Math.round(a.getBoundingClientRect().top),
      }));
      return {
        vb: svg.getAttribute("viewBox"),
        origin: g?.style.transformOrigin || "(kosong)",
        arcs,
      };
    });
    const buf = await p.screenshot({
      clip: { x: 0, y: Math.max(0, h - pita), width: w, height: pita },
    });
    const piksel = await analisisLime(buf);
    console.log(nama, JSON.stringify({ ...geo, ...piksel }));
    await p.close();
  }
  await b.close();
})();
