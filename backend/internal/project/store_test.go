package project

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(filepath.Join(t.TempDir(), "projects"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return s
}

func TestCreateGetDelete(t *testing.T) {
	s := newTestStore(t)

	p, err := s.Create("Ein Käfig voller Narren", "stück.pdf", strings.NewReader("%PDF-1.4\n"))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if p.ID != "ein-kaefig-voller-narren" {
		t.Fatalf("slug = %q", p.ID)
	}

	got, err := s.Get(p.ID)
	if err != nil || got.Name != p.Name {
		t.Fatalf("Get: %v / %+v", err, got)
	}

	// A second project with the same name must not collide.
	p2, err := s.Create("Ein Käfig voller Narren", "x.pdf", strings.NewReader("%PDF"))
	if err != nil {
		t.Fatalf("Create #2: %v", err)
	}
	if p2.ID == p.ID {
		t.Fatalf("duplicate slug %q", p2.ID)
	}

	list, err := s.List()
	if err != nil || len(list) != 2 {
		t.Fatalf("List: %v, %d entries", err, len(list))
	}

	if err := s.Delete(p.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := s.Get(p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get after delete = %v, want ErrNotFound", err)
	}
}

func TestBlocksAreSortedAndDirectionsLoseSpeaker(t *testing.T) {
	s := newTestStore(t)
	p, err := s.Create("Hamlet", "h.pdf", strings.NewReader("%PDF"))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	hugo := "HUGO"
	in := []Block{
		{ID: "b2", Page: 1, Order: 2, Type: TypeDirection, Speaker: &hugo, Text: "geht ab"},
		{ID: "b1", Page: 1, Order: 1, Type: TypeLine, Speaker: &hugo, Text: "Sein oder nicht sein"},
	}
	if err := s.SaveBlocks(p.ID, in); err != nil {
		t.Fatalf("SaveBlocks: %v", err)
	}

	out, err := s.Blocks(p.ID)
	if err != nil {
		t.Fatalf("Blocks: %v", err)
	}
	if len(out) != 2 || out[0].ID != "b1" {
		t.Fatalf("blocks not sorted by order: %+v", out)
	}
	if out[1].Speaker != nil {
		t.Fatalf("stage direction kept a speaker: %+v", out[1])
	}
}

func TestUpdateMyRole(t *testing.T) {
	s := newTestStore(t)
	p, _ := s.Create("Faust", "f.pdf", strings.NewReader("%PDF"))

	role := "FAUST"
	pages := 42
	updated, err := s.Update(p.ID, ProjectUpdate{MyRole: &role, PageCount: &pages})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.MyRole != role || updated.PageCount != pages {
		t.Fatalf("update not applied: %+v", updated)
	}
	reread, _ := s.Get(p.ID)
	if reread.MyRole != role {
		t.Fatalf("update not persisted: %+v", reread)
	}
}

func TestValidIDRejectsTraversal(t *testing.T) {
	for _, bad := range []string{"", "..", "../etc", "a/b", "a\\b", "."} {
		if validID(bad) {
			t.Fatalf("validID(%q) = true, want false", bad)
		}
	}
	if !validID("hamlet-2026") {
		t.Fatal("validID rejected a normal slug")
	}
}

func TestSpeakersDefaults(t *testing.T) {
	s := newTestStore(t)
	p, _ := s.Create("Woyzeck", "w.pdf", strings.NewReader("%PDF"))

	sp, err := s.Speakers(p.ID)
	if err != nil {
		t.Fatalf("Speakers: %v", err)
	}
	if _, ok := sp[DirectionKey]; !ok {
		t.Fatalf("default speakers must contain %q: %+v", DirectionKey, sp)
	}
}

func TestProgressRoundTrip(t *testing.T) {
	s := newTestStore(t)
	p, err := s.Create("Der Besuch der alten Dame", "stueck.pdf", strings.NewReader("%PDF"))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if p.Progress != nil {
		t.Fatalf("a fresh project must not carry progress: %+v", p.Progress)
	}

	saved, err := s.SaveProgress(p.ID, Progress{
		BlockID:   "b7",
		Page:      12,
		Order:     42,
		Role:      "ILL",
		Index:     41,
		Total:     120,
		Selection: &RunSelection{Mode: "role", Lead: 2, Trail: 1, MergeGap: 3, Announce: true},
	})
	if err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	if saved.Progress == nil || saved.Progress.BlockID != "b7" || saved.Progress.Page != 12 {
		t.Fatalf("progress not returned: %+v", saved.Progress)
	}
	// The client does not get to set this – a skewed clock there would make
	// "last rehearsed" meaningless.
	if saved.Progress.UpdatedAt.IsZero() {
		t.Fatal("UpdatedAt must be stamped by the store")
	}

	got, err := s.Get(p.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Progress == nil || got.Progress.Role != "ILL" || got.Progress.Order != 42 {
		t.Fatalf("progress lost on reload: %+v", got.Progress)
	}
	if got.Progress.Selection == nil || got.Progress.Selection.Mode != "role" ||
		got.Progress.Selection.Lead != 2 {
		t.Fatalf("selection lost on reload: %+v", got.Progress.Selection)
	}
	// Writing the position must leave the rest of the project file alone.
	if got.Name != p.Name || got.PDFFile != p.PDFFile || got.PageCount != p.PageCount {
		t.Fatalf("project metadata changed: %+v", got)
	}

	cleared, err := s.ClearProgress(p.ID)
	if err != nil {
		t.Fatalf("ClearProgress: %v", err)
	}
	if cleared.Progress != nil {
		t.Fatalf("progress still set: %+v", cleared.Progress)
	}
	again, err := s.Get(p.ID)
	if err != nil || again.Progress != nil {
		t.Fatalf("progress came back after clearing: %v / %+v", err, again.Progress)
	}
}

func TestProgressUnknownProject(t *testing.T) {
	s := newTestStore(t)

	if _, err := s.SaveProgress("gibt-es-nicht", Progress{BlockID: "b1"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("SaveProgress on a missing project: err = %v", err)
	}
	if _, err := s.ClearProgress("gibt-es-nicht"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ClearProgress on a missing project: err = %v", err)
	}
}
