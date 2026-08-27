# Builds the single deployable artifact decided for hosting (see
# memory.md): one Go binary embedding the built frontend, so production has
# no CORS to configure and only one thing to run. Mirrors
# scripts/build-embedded.sh's steps as separate Docker stages so each is
# cached independently (frontend deps rarely change alongside Go code).
#
# Build with: docker build --build-arg ANYWAY_API_TOKEN=<token> -t anyway .
# ANYWAY_API_TOKEN is baked into the frontend bundle at build time (it must
# match the same token the running server is given at deploy time via the
# ANYWAY_API_TOKEN env var/secret) — see docs/architecture.md §B1: this is
# a single static bearer token, not real auth, by design (one user).

FROM node:22-alpine AS frontend
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
ARG ANYWAY_API_TOKEN
# Empty VITE_API_BASE — same origin as the Go binary serving this build.
RUN VITE_API_BASE="" VITE_API_TOKEN="$ANYWAY_API_TOKEN" npm run build

FROM golang:1.25-alpine AS backend
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# go:embed can't reach outside its own package dir — see
# internal/webapp's doc comment — so the frontend build lands here first.
COPY --from=frontend /src/app/dist/. ./internal/webapp/dist/
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/anyway-server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend /out/anyway-server /anyway-server
EXPOSE 8080
ENTRYPOINT ["/anyway-server"]
