package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/bloodmage/theater-tts/backend/internal/project"
)

// maxRecording caps the upload. A single line of a play is seconds long; a
// hundred megabytes of it is a mistake, not a rehearsal.
const maxRecording = 25 << 20

func (a *API) sttInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.stt.Info())
}

// transcribeBlock takes the recording of one block and returns what was
// understood. The comparison with the text happens in the frontend, so
// correcting the block re-colours the result without asking the recogniser
// again – it heard what it heard either way.
func (a *API) transcribeBlock(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	blockID := chi.URLParam(r, "blockId")

	blocks, err := a.store.Blocks(id)
	if err != nil {
		storeError(w, err)
		return
	}
	found := false
	for _, b := range blocks {
		if b.ID == blockID {
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, errors.New("Block gehört nicht zu diesem Projekt"))
		return
	}
	if !a.stt.Available() {
		info := a.stt.Info()
		writeError(w, http.StatusFailedDependency, fmt.Errorf(
			"keine Spracherkennung gefunden. Versucht: %s. Siehe README, Abschnitt Lernmodus. %s",
			strings.Join(info.Tried, ", "), info.Detail))
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRecording)
	if err := r.ParseMultipartForm(maxRecording); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	file, header, err := r.FormFile("audio")
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("Feld \"audio\" fehlt"))
		return
	}
	defer file.Close()

	dir, err := os.MkdirTemp("", "theater-take-")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	defer os.RemoveAll(dir)

	// Whisper picks the decoder by extension, and the browser sends WebM.
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".webm"
	}
	path := filepath.Join(dir, "take"+ext)
	dst, err := os.Create(path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if _, err := io.Copy(dst, file); err != nil {
		dst.Close()
		writeError(w, http.StatusBadRequest, err)
		return
	}
	dst.Close()

	text, err := a.stt.Transcribe(r.Context(), path, speakerNames(blocks))
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"text":   text,
		"engine": a.stt.Info().Command,
	})
}

// speakerNames collects the character names of the play, in first-appearance
// order – they go to the recogniser as a vocabulary hint.
func speakerNames(blocks []project.Block) []string {
	seen := map[string]bool{}
	var out []string
	for _, b := range blocks {
		if b.Type != project.TypeLine || b.Speaker == nil {
			continue
		}
		name := strings.TrimSpace(*b.Speaker)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}
