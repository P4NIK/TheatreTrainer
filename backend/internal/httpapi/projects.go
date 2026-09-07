package httpapi

import (
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"time"

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
	// A premiere that cannot be parsed would silently switch the flashcard
	// ceiling off, and nobody would notice until the intervals got long.
	if u.Premiere != nil {
		if d := strings.TrimSpace(*u.Premiere); d != "" {
			if _, err := time.Parse(project.DateLayout, d); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("Premierentermin bitte als JJJJ-MM-TT angeben"))
				return
			}
		}
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

// putProgress stores where the rehearsal run currently stands. It gets its own
// route rather than riding along on updateProject because a running rehearsal
// writes it every few seconds, and that should not be able to race a rename or
// a role change into the same file.
func (a *API) putProgress(w http.ResponseWriter, r *http.Request) {
	var pr project.Progress
	if err := decodeJSON(r, &pr); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	// The block is the anchor the position is resolved from later; without it
	// there is nothing to come back to.
	if strings.TrimSpace(pr.BlockID) == "" {
		writeError(w, http.StatusBadRequest, errors.New("Feld \"blockId\" fehlt"))
		return
	}
	p, err := a.store.SaveProgress(chi.URLParam(r, "id"), pr)
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// deleteProgress is "start over": the position is forgotten, the project keeps
// everything else.
func (a *API) deleteProgress(w http.ResponseWriter, r *http.Request) {
	p, err := a.store.ClearProgress(chi.URLParam(r, "id"))
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *API) getCards(w http.ResponseWriter, r *http.Request) {
	cards, err := a.store.Cards(chi.URLParam(r, "id"))
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cards)
}

// patchCards merges single cards into the deck instead of replacing it.
//
// A session grades one line at a time; sending the whole deck back for each of
// them would make two windows on the same play overwrite one another's work. A
// null entry deletes that card.
func (a *API) patchCards(w http.ResponseWriter, r *http.Request) {
	var patch map[string]*project.Card
	if err := decodeJSON(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	for id, card := range patch {
		if card == nil {
			continue
		}
		if card.Box < 1 {
			writeError(w, http.StatusBadRequest, errors.New("Fach von \""+id+"\" muss mindestens 1 sein"))
			return
		}
		if card.Due != "" {
			if _, err := time.Parse(project.DateLayout, card.Due); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("Fälligkeit von \""+id+"\" bitte als JJJJ-MM-TT angeben"))
				return
			}
		}
	}
	cards, err := a.store.MergeCards(chi.URLParam(r, "id"), patch)
	if err != nil {
		storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cards)
}

// deleteCards forgets the learning state, not the lines themselves.
func (a *API) deleteCards(w http.ResponseWriter, r *http.Request) {
	if err := a.store.ClearCards(chi.URLParam(r, "id")); err != nil {
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
