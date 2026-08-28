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
# go:embed can't reach outside its own package dir — see
# internal/webapp's doc comment — so the frontend build lands here first.
COPY --from=frontend /src/app/dist/. ./internal/webapp/dist/
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/anyway-server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend /out/anyway-server /anyway-server
EXPOSE 8080
ENTRYPOINT ["/anyway-server"]
