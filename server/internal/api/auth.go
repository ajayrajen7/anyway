package api

import "net/http"

// BearerAuth enforces the single static bearer token (B1: "One user. Do not
// build auth."). Constant-time-ish is unnecessary here — this is a personal
// single-device app, not a multi-tenant service — but we still reject on any
// mismatch rather than partial-match.
func BearerAuth(token string) func(http.Handler) http.Handler {
	want := "Bearer " + token
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token == "" || r.Header.Get("Authorization") != want {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
