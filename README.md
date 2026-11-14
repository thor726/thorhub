# ThorHub — Workspace Monorepo

Satu repo, banyak project mandiri. **Kode aplikasi tidak pernah ditaruh di root.**

    project/
    ├── package.json          # konfigurasi workspace + perintah pintas
    ├── .gitignore            # aturan ignore yang berlaku ke semua project
    ├── jsconfig.json         # IntelliSense editor
    ├── README.md             # berkas ini
    ├── scripts/              # perkakas workspace (bukan kode aplikasi)
    └── apps/
        ├── README.md         # katalog project
        └── llm-gateway/      # ThorHub — LLM Proxy Gateway (Express + SQLite)

## Cara jalan

Setiap project berdiri sendiri (punya `package.json` dan `node_modules` sendiri),
jadi dependensi tidak saling tabrakan antar project.

    cd apps/llm-gateway && npm install     # sekali per project

    npm run gateway          # dev server llm-gateway (watch mode)
    npm run gateway:start    # jalankan tanpa watch
    npm test                 # test project llm-gateway
    npm run test:semua       # test semua project di apps/

## Menambah project baru

    npm run app:baru -- nama-project
    cd apps/nama-project && npm install

Scaffolder membuat struktur dasar: `src/`, `test/`, `public/`, `data/`,
`package.json`, `README.md`, `.gitignore`, `.env.example` — lalu mendaftarkannya
ke tabel katalog di `apps/README.md`.

Lihat daftar project yang ada: `npm run app:daftar`.

## Konvensi

- **Rahasia** hanya di `.env` (gitignored). Sertakan `.env.example` sebagai template;
  nilai asli tidak pernah di-commit.
- **Test** ditaruh di `test/` dan dijalankan lewat `npm test` project masing-masing.
- **Data runtime** (database, upload) masuk `data/` dan tidak di-commit.
- **Path** selalu relatif terhadap folder project (`__dirname`), jangan hardcode
  path absolut mesin lokal.
- **Port** diambil dari `.env` (`PORT`), jangan ditulis mati di kode.
