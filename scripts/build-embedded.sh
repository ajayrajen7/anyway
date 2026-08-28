#!/usr/bin/env sh
# Builds the frontend, copies its output into server/internal/webapp/dist
# (go:embed can't reach outside its own package directory — see that
# package's doc comment), then builds the single self-contained Go binary
# that serves both the PWA and the API. Used by the Dockerfile, and usable
# locally for a one-off production-shaped build.
#
# VITE_API_BASE is forced empty so the built frontend calls relative
# /api/... paths — same origin as the binary serving it, no CORS needed in
# this deploy shape (see app/.env.example's own comment). ANYWAY_API_TOKEN
# is NOT needed to build — the server injects it into index.html at serve
# time from its own runtime env var (see server/internal/webapp), not baked
# in here — so this build is identical regardless of who runs the binary
# or what token they give it at runtime.
set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> building frontend"
cd "$repo_root/app"
VITE_API_BASE="" npm run build

echo "==> copying frontend build into server/internal/webapp/dist"
dist_dest="$repo_root/server/internal/webapp/dist"
rm -rf "$dist_dest"
mkdir -p "$dist_dest"
cp -r "$repo_root/app/dist/." "$dist_dest/"

echo "==> building server binary"
cd "$repo_root/server"
CGO_ENABLED=0 go build -o "$repo_root/server/anyway-server" ./cmd/server

echo "==> done: $repo_root/server/anyway-server"
