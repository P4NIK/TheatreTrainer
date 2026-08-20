package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// staticHandler serves the production build of the frontend if
// frontend/dist exists next to the checkout. Returns nil during development,
// where Vite serves the UI on its own port.
func staticHandler() http.HandlerFunc {
	dist := findDist()
	if dist == "" {
		return nil
	}
	fs := http.FileServer(http.Dir(dist))
	index := filepath.Join(dist, "index.html")

	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		p := filepath.Join(dist, filepath.Clean("/"+r.URL.Path))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, index) // SPA fallback
	}
}

func findDist() string {
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	dir := wd
	for i := 0; i < 6; i++ {
		cand := filepath.Join(dir, "frontend", "dist")
		if st, err := os.Stat(filepath.Join(cand, "index.html")); err == nil && !st.IsDir() {
			return cand
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
