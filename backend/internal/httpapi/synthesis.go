package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/bloodmage/theater-tts/backend/internal/project"
	"github.com/bloodmage/theater-tts/backend/internal/synth"
)

func (a *API) listVoices(w http.ResponseWriter, r *http.Request) {
	list, err := a.registry.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	info := a.synth.PiperInfo()
	writeJSON(w, http.StatusOK, map[string]any{
		"dir":            a.registry.Dir(),
		"piperAvailable": info.Available,
		"piper":          info,
		"voices":         list,
	})
}

type previewRequest struct {
	Model       string  `json:"model"`
	SpeakerID   int     `json:"speakerId"`
	LengthScale float64 `json:"lengthScale"`
	Volume      float64 `json:"volume"`
	Pitch       float64 `json:"pitch"`
	Text        string  `json:"text"`
}

func (a *API) previewVoice(w http.ResponseWriter, r *http.Request) {
	var req previewRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if req.Model == "" {
		writeError(w, http.StatusBadRequest, errors.New("Feld \"model\" fehlt"))
		return
	}
	if req.LengthScale <= 0 {
		req.LengthScale = 1.0
	}
	if req.Volume <= 0 {
		req.Volume = 1.0
	}
	if req.Pitch <= 0 {
		req.Pitch = 1.0
	}

	data, err := a.synth.Preview(r.Context(), synth.Request{
		Text:        req.Text,
		Model:       req.Model,
		SpeakerID:   req.SpeakerID,
		LengthScale: req.LengthScale,
		Volume:      req.Volume,
		Pitch:       req.Pitch,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

type synthRequest struct {
	SkipMyRole        bool `json:"skipMyRole"`
	IncludeDirections bool `json:"includeDirections"`
	// Selection restricts the run to a part of the play. Empty means all of it.
	Selection []synth.SelectionItem `json:"selection,omitempty"`
}

func (a *API) startSynthesis(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req synthRequest
	if r.ContentLength > 0 {
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}
	opts := synth.Options{SkipMyRole: req.SkipMyRole, IncludeDirections: req.IncludeDirections}

	problems, err := a.synth.Validate(id, opts, req.Selection)
	if err != nil {
		storeError(w, err)
		return
	}
	if len(problems) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":    "Es fehlen Stimmen-Zuweisungen",
			"problems": problems,
		})
		return
	}
	if info := a.synth.PiperInfo(); !info.Available {
		writeError(w, http.StatusFailedDependency, fmt.Errorf(
			"Piper wurde nicht gefunden. Versucht: %s. Bitte installieren oder PIPER_BIN setzen (siehe README). %s",
			strings.Join(info.Tried, ", "), info.Detail))
		return
	}

	job, err := a.synth.Start(id, opts, req.Selection)
	if err != nil {
		if errors.Is(err, synth.ErrEmptySelection) {
			writeError(w, http.StatusUnprocessableEntity, err)
			return
		}
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (a *API) jobStatus(w http.ResponseWriter, r *http.Request) {
	job, ok := a.synth.Jobs.Get(chi.URLParam(r, "jobId"))
	if !ok || job.ProjectID != chi.URLParam(r, "id") {
		writeError(w, http.StatusNotFound, errors.New("Job nicht gefunden"))
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (a *API) cancelJob(w http.ResponseWriter, r *http.Request) {
	if !a.synth.Jobs.Cancel(chi.URLParam(r, "jobId")) {
		writeError(w, http.StatusNotFound, errors.New("Job nicht gefunden"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) getAudio(w http.ResponseWriter, r *http.Request) {
	job, ok := a.synth.Jobs.Get(chi.URLParam(r, "jobId"))
	if !ok || job.ProjectID != chi.URLParam(r, "id") {
		writeError(w, http.StatusNotFound, errors.New("Job nicht gefunden"))
		return
	}
	if job.Status != synth.StatusDone || job.FilePath() == "" {
		writeError(w, http.StatusConflict, errors.New("Job ist noch nicht fertig"))
		return
	}
	f, err := os.Open(job.FilePath())
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	ct := "audio/wav"
	if filepath.Ext(job.FilePath()) == ".mp3" {
		ct = "audio/mpeg"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", `inline; filename="`+filepath.Base(job.FilePath())+`"`)
	http.ServeContent(w, r, filepath.Base(job.FilePath()), st.ModTime(), f)
}

// getBlockAudio renders one block for playback in the editor. It goes through
// the same cache as a full run, so a block that was rendered once plays back
// immediately – and a block played here is already done when the whole play is
// assembled later.
func (a *API) getBlockAudio(w http.ResponseWriter, r *http.Request) {
	data, err := a.synth.RenderSingleBlock(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "blockId"))
	if err != nil {
		if errors.Is(err, project.ErrNotFound) {
			storeError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, err)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (a *API) cacheStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := a.store.Get(id); err != nil {
		storeError(w, err)
		return
	}
	files, bytes := a.synth.Cache(id).Stats()
	writeJSON(w, http.StatusOK, map[string]any{"files": files, "bytes": bytes})
}

func (a *API) clearCache(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := a.store.Get(id); err != nil {
		storeError(w, err)
		return
	}
	if err := a.synth.Cache(id).Clear(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
