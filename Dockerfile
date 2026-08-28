# Builds the single deployable artifact decided for hosting (see
# memory.md): one Go binary embedding the built frontend, so production has
# no CORS to configure and only one thing to run. Mirrors
# scripts/build-embedded.sh's steps as separate Docker stages so each is
# cached independently (frontend deps rarely change alongside Go code).
#
# No build args needed: ANYWAY_API_TOKEN (architecture.md §B1's single
# static bearer token) is a plain runtime environment variable on whatever
# host runs the final image — the Go server injects it into index.html at
# serve time (see server/internal/webapp#injectConfig). This is deliberate,
# not an oversight: not every hosting platform's dashboard supports custom
# Docker build arguments (discovered when Render's didn't), but every one
# of them supports a runtime env var.

FROM node:22-alpine AS frontend
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
# Empty VITE_API_BASE — same origin as the Go binary serving this build.
RUN VITE_API_BASE="" npm run build

FROM golang:1.25-alpine AS backend
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# go:embed can't reach outside its own package dir — see internal/webapp's
# and internal/bootstrap's doc comments — so the frontend build and the
# real seed data both land here before `go build`. internal/bootstrap
# auto-seeds a fresh deploy's empty database with these on first run.
COPY --from=frontend /src/app/dist/. ./internal/webapp/dist/
COPY seed/exercises.json seed/phase1.json ./internal/bootstrap/data/
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/anyway-server ./cmd/server

# Root, not :nonroot — a real Railway deploy failed here: a freshly
# mounted persistent volume is root-owned with restrictive permissions by
# default, mounted before the app process ever starts, and this image has
# no shell to chown it even if we wanted to. Running as root inside one
# isolated single-user container (not the host) is a reasonable tradeoff
# against not being able to write the one persistent volume the whole app
# exists to use. See memory.md.
FROM gcr.io/distroless/static-debian12
COPY --from=backend /out/anyway-server /anyway-server
EXPOSE 8080
ENTRYPOINT ["/anyway-server"]
