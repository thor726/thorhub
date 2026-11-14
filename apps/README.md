# apps/ — Katalog Project

Setiap project mandiri menempati satu sub-folder di dalam `apps/`.
Root repo **tidak berisi kode aplikasi** — root hanya berisi konfigurasi workspace
(`package.json`, `.gitignore`, `jsconfig.json`), `scripts/`, dan `README.md`.

## Project yang sudah ada

| Folder | Nama | Stack | Cara jalan |
| --- | --- | --- | --- |
| `apps/llm-gateway/` | ThorHub — LLM Proxy Gateway | Node.js + Express + SQLite | `npm run gateway` (dari root) |
<!-- app-baru:baris-katalog -->

## Menambah project baru

Cara cepat — scaffolder workspace:

    npm run app:baru -- nama-project
    cd apps/nama-project && npm install

Cara manual:

    mkdir -p apps/nama-project/src
    cd apps/nama-project
    npm init -y

Setelah itu isi `README.md` project: cara install, cara jalan, cara test.

## Cara project di sini saling terpisah

Repo ini **bukan** npm workspaces (`"workspaces": []` di root). Setiap project
punya `package.json`, `package-lock.json`, dan `node_modules` sendiri.

Alasannya: beberapa project butuh dependensi native per mesin (misalnya
`better-sqlite3` yang harus dikompilasi ulang), dan hoisting node_modules ke root
membuat build lokal satu mesin merusak mesin lain.

Konsekuensinya:

- `-w` / `--workspaces` **tidak berlaku** di repo ini.
- Perintah dijalankan dengan `--prefix` (sudah dibungkus jadi script root),
  atau langsung dari dalam folder project.
- `npm install` dijalankan per project, bukan sekali di root.

## Konvensi yang dipakai semua project di folder ini

- **Rahasia** masuk `.env` (di-gitignore). Sertakan `.env.example` sebagai template —
  jangan pernah commit nilai asli.
- **Test** ditaruh di `test/` dan bisa dijalankan lewat `npm test`.
- **Data runtime** (database, upload) ditaruh di `data/` dan tidak di-commit.
- **Path** selalu relatif terhadap folder project sendiri (`__dirname`), jangan
  hardcode path absolut mesin lokal.
- **Port & konfigurasi lain** lewat env var / `.env`, jangan hardcode.
