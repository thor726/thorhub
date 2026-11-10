#!/bin/bash
# Nyalakan mock-provider (9999) + gateway (3000) secara terpisah dari sesi shell.
PROYEK=/home/z/my-project/llm-proxy-gateway

jalan() {  # jalan <url> <logfile> <args...>
  if curl -s -o /dev/null -m 2 "$1"; then return 0; fi
  ( cd "$PROYEK" && setsid nohup node "${@:3}" > "$2" 2>&1 < /dev/null & )
}

jalan http://localhost:9999/v1/models /tmp/mock.log test/mock-provider.js
jalan http://localhost:3000/ /tmp/gw.log src/server.js

# Tunggu maksimal 10 detik sampai keduanya siap
for i in $(seq 1 20); do
  g=$(curl -s -o /dev/null -m 2 -w "%{http_code}" http://localhost:3000/)
  m=$(curl -s -o /dev/null -m 2 -w "%{http_code}" http://localhost:9999/v1/models)
  [ "$g" = "200" ] && [ "$m" = "200" ] && { echo "SIAP (gateway:$g mock:$m)"; exit 0; }
  sleep 0.5
done
echo "GAGAL (gateway:$g mock:$m)"; tail -5 /tmp/gw.log /tmp/mock.log; exit 1
