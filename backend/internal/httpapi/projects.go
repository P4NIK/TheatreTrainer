package httpapi

import (
	"errors"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/bloodmage/theater-tts/backend/internal/project"
)

// maxPDFBytes caps the multipart upload (a play PDF is rarely above 100 MB).
const maxPDFBytes = 200 << 20

func (a *API) listProjects(w http.ResponseWriter, r *http.Request) {
	list, err := a.store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *API) createProject(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("Upload konnte nicht gelesen werden: "+err.Error()))
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, errors.New("Feld \"name\" fehlt"))
		return
	}

	file, header, err := r.FormFile("pdf")
	if err != nil {
		writeError(w, http.StatusBadRequest, errors.New("Feld \"pdf\" fehlt"))
		return
	}
	defer file.Close()

	if header.Size > maxPDFBytes {
		writeError(w, http.StatusRequestEntityTooLarge, errors.New("PDF ist zu groß"))
		return
	}
	if ext := strings.ToLower(filepath.Ext(header.Filename)); ext != ".pdf" {
		writeError(w, http.StatusBadRequest, errors.New("es werden nur PDF-Dateien unterstützt"))
		return
	}

	p, err := a.store.Create(name, header.Filename, file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (a *API) getProject(w http.ResponseWriter, r *http.Request) {
	p, err := a.store.Get(chi.URLParam(r, "id"))
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *API) updateProject(w http.ResponseWriter, r *http.Request) {
	var u project.ProjectUpdate
	if err := decodeJSON(r, &u); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	p, err := a.store.Update(chi.URLParam(r, "id"), u)
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *API) deleteProject(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Delete(chi.URLParam(r, "id")); err != nil {
		storeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) getPDF(w http.ResponseWriter, r *http.Request) {
	path, err := a.store.PDFPath(chi.URLParam(r, "id"))
	if err != nil {
		storeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, path)
}

func (a *API) getBlocks(w http.ResponseWriter, r *http.Request) {
	blocks, err := a.store.Blocks(chi.URLParam(r, "id"))
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, blocks)
}

func (a *API) putBlocks(w http.ResponseWriter, r *http.Request) {
	var blocks []project.Block
	if err := decodeJSON(r, &blocks); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	id := chi.URLParam(r, "id")
	if err := a.store.SaveBlocks(id, blocks); err != nil {
		storeError(w, err)
		return
	}
	saved, err := a.store.Blocks(id)
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *API) getSpeakers(w http.ResponseWriter, r *http.Request) {
	sp, err := a.store.Speakers(chi.URLParam(r, "id"))
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sp)
}

func (a *API) putSpeakers(w http.ResponseWriter, r *http.Request) {
	var sp project.Speakers
	if err := decodeJSON(r, &sp); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	id := chi.URLParam(r, "id")
	if err := a.store.SaveSpeakers(id, sp); err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sp)
}
