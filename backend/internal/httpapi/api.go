// Package httpapi wires the HTTP routes to the storage and synthesis layers.
package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/bloodmage/theater-tts/backend/internal/config"
	"github.com/bloodmage/theater-tts/backend/internal/project"
	"github.com/bloodmage/theater-tts/backend/internal/stt"
	"github.com/bloodmage/theater-tts/backend/internal/synth"
	"github.com/bloodmage/theater-tts/backend/internal/voices"
)

// API bundles the dependencies of all handlers.
type API struct {
	cfg      *config.Config
	store    *project.Store
	registry *voices.Registry
	synth    *synth.Service
	stt      *stt.Service
}

// New creates the API.
func New(cfg *config.Config, store *project.Store, reg *voices.Registry, sv *synth.Service, st *stt.Service) *API {
	return &API{cfg: cfg, store: store, registry: reg, synth: sv, stt: st}
}

// Router returns the fully wired chi router.
func (a *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)
	r.Use(devCORS)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", a.health)

		r.Route("/projects", func(r chi.Router) {
			r.Get("/", a.listProjects)
			r.Post("/", a.createProject)

			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", a.getProject)
				r.Put("/", a.updateProject)
				r.Delete("/", a.deleteProject)
				r.Get("/pdf", a.getPDF)
				r.Get("/blocks", a.getBlocks)
				r.Put("/blocks", a.putBlocks)
				r.Get("/blocks/{blockId}/audio", a.getBlockAudio)
				r.Post("/blocks/{blockId}/transcribe", a.transcribeBlock)
				r.Get("/cache", a.cacheStatus)
				r.Delete("/cache", a.clearCache)
				r.Get("/speakers", a.getSpeakers)
				r.Put("/speakers", a.putSpeakers)
				r.Post("/synthesize", a.startSynthesis)
				r.Get("/synthesize/{jobId}", a.jobStatus)
				r.Delete("/synthesize/{jobId}", a.cancelJob)
				r.Get("/audio/{jobId}", a.getAudio)
			})
		})

		r.Get("/stt", a.sttInfo)
		r.Get("/voices", a.listVoices)
		r.Post("/voices/preview", a.previewVoice)
	})

	// Serve the built frontend when it exists, so a single binary can host
	// the whole app in production. During development Vite serves it.
	if h := staticHandler(); h != nil {
		r.NotFound(h)
	}
	return r
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	info := a.synth.PiperInfo()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"piperAvailable": info.Available,
		"piper":          info,
		"voicesDir":      a.registry.Dir(),
	})
}

// --- helpers ---------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("json encode: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	msg := "unbekannter Fehler"
	if err != nil {
		msg = err.Error()
	}
	writeJSON(w, status, map[string]string{"error": msg})
}

// storeError maps storage errors to HTTP status codes.
func storeError(w http.ResponseWriter, err error) {
	if errors.Is(err, project.ErrNotFound) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeError(w, http.StatusInternalServerError, err)
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}

// devCORS allows the Vite dev server to talk to the API directly. The app
// only ever listens on localhost, so this is not a security boundary.
func devCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
