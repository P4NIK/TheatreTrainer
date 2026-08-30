package synth

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/bloodmage/theater-tts/backend/internal/config"
	"github.com/bloodmage/theater-tts/backend/internal/project"
	"github.com/bloodmage/theater-tts/backend/internal/voices"
)

// testService builds a service on a throwaway data directory with one play and
// two "installed" voices. Nothing here talks to Piper – plan() only decides
// what would be rendered.
func testService(t *testing.T, myRole string, blocks []project.Block, speakers project.Speakers) *Service {
	t.Helper()
	root := t.TempDir()

	voicesDir := filepath.Join(root, "voices")
	if err := os.MkdirAll(voicesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"voice-a", "voice-b"} {
		write(t, filepath.Join(voicesDir, name+".onnx"), []byte("x"))
		write(t, filepath.Join(voicesDir, name+".onnx.json"),
			[]byte(`{"audio":{"sample_rate":22050},"num_speakers":1}`))
	}

	dir := filepath.Join(root, "projects", "p")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeJSON(t, filepath.Join(dir, "project.json"), project.Project{
		ID: "p", Name: "Stück", PDFFile: "source.pdf", PageCount: 9, MyRole: myRole,
	})
	writeJSON(t, filepath.Join(dir, "blocks.json"), blocks)
	writeJSON(t, filepath.Join(dir, "speakers.json"), speakers)

	store, err := project.NewStore(filepath.Join(root, "projects"))
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{DataDir: root, VoicesDir: voicesDir, SampleRate: 22050}
	return NewService(cfg, store, voices.New(voicesDir))
}

func write(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeJSON(t *testing.T, path string, v any) {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	write(t, path, data)
}

func line(id string, order int, page int, speaker, text string) project.Block {
	s := speaker
	return project.Block{ID: id, Page: page, Order: order, Type: project.TypeLine, Speaker: &s, Text: text}
}

var samplePlay = []project.Block{
	line("b1", 1, 1, "SIR", "Guten Abend."),
	line("b2", 2, 1, "HUGO", "Ebenfalls."),
	line("b3", 3, 2, "SIR", "Wie geht es?"),
	line("b4", 4, 3, "HUGO", "Danke, gut."),
}

var sampleSpeakers = project.Speakers{
	"SIR":                {Model: "voice-a", LengthScale: 1, Volume: 1, Pitch: 1},
	"HUGO":               {Model: "voice-b", LengthScale: 1, Volume: 1, Pitch: 1},
	project.DirectionKey: {Model: "voice-a", LengthScale: 1, Volume: 1, Pitch: 1},
}

func TestPlanWithoutSelectionTakesTheWholePlay(t *testing.T) {
	s := testService(t, "HUGO", samplePlay, sampleSpeakers)

	items, problems, err := s.plan("p", Options{IncludeDirections: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(problems) != 0 {
		t.Fatalf("unerwartete Probleme: %v", problems)
	}
	if len(items) != 4 {
		t.Fatalf("erwartet 4 Einträge, bekommen %d", len(items))
	}
}

func TestPlanFollowsTheSelectionOrderAndSkipsUnknownBlocks(t *testing.T) {
	s := testService(t, "HUGO", samplePlay, sampleSpeakers)

	items, _, err := s.plan("p", Options{IncludeDirections: true}, []SelectionItem{
		{BlockID: "b3"},
		{BlockID: "gibtsnicht"},
		{BlockID: "b1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("erwartet 2 Einträge, bekommen %d", len(items))
	}
	if items[0].req.Text != "Wie geht es?" || items[1].req.Text != "Guten Abend." {
		t.Fatalf("Reihenfolge der Auswahl nicht eingehalten: %q, %q", items[0].req.Text, items[1].req.Text)
	}
}

func TestPlanSpeaksJumpMarkersWithTheDirectionVoice(t *testing.T) {
	s := testService(t, "HUGO", samplePlay, sampleSpeakers)

	items, _, err := s.plan("p", Options{IncludeDirections: true}, []SelectionItem{
		{Announce: "Weiter auf Seite 2."},
		{BlockID: "b3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("erwartet 2 Einträge, bekommen %d", len(items))
	}
	if items[0].req.Text != "Weiter auf Seite 2." {
		t.Fatalf("Ansage fehlt: %+v", items[0].req)
	}
	if items[0].req.Model != "voice-a" {
		t.Fatalf("Ansage nutzt nicht die Regie-Stimme: %q", items[0].req.Model)
	}
}

func TestPlanDropsJumpMarkersWithoutADirectionVoice(t *testing.T) {
	speakers := project.Speakers{
		"SIR":  {Model: "voice-a", LengthScale: 1, Volume: 1, Pitch: 1},
		"HUGO": {Model: "voice-b", LengthScale: 1, Volume: 1, Pitch: 1},
	}
	s := testService(t, "HUGO", samplePlay, speakers)

	items, problems, err := s.plan("p", Options{IncludeDirections: true}, []SelectionItem{
		{Announce: "Weiter auf Seite 2."},
		{BlockID: "b3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	// The marker is an aid, not content – it is dropped instead of failing.
	if len(items) != 1 || len(problems) != 0 {
		t.Fatalf("erwartet 1 Eintrag ohne Probleme, bekommen %d / %v", len(items), problems)
	}
}

func TestPlanMarksOwnLinesAsSkippedButStillRendersThem(t *testing.T) {
	s := testService(t, "HUGO", samplePlay, sampleSpeakers)

	items, _, err := s.plan("p", Options{SkipMyRole: true, IncludeDirections: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	skipped := 0
	for _, it := range items {
		if it.skip {
			skipped++
			if it.fixedPause {
				t.Fatal("mit zugewiesener Stimme darf keine feste Pause nötig sein")
			}
			if it.req.Text == "" {
				t.Fatal("eine übersprungene Replik muss trotzdem synthetisiert werden")
			}
		}
	}
	if skipped != 2 {
		t.Fatalf("erwartet 2 übersprungene Repliken, bekommen %d", skipped)
	}
}

func TestPlanReportsMissingVoicesOnlyForSelectedBlocks(t *testing.T) {
	speakers := project.Speakers{
		"HUGO":               {Model: "voice-b", LengthScale: 1, Volume: 1, Pitch: 1},
		project.DirectionKey: {Model: "voice-a", LengthScale: 1, Volume: 1, Pitch: 1},
	}
	s := testService(t, "HUGO", samplePlay, speakers)

	// SIR has no voice, but no SIR block is part of this selection.
	if problems, err := s.Validate("p", Options{}, []SelectionItem{{BlockID: "b2"}}); err != nil {
		t.Fatal(err)
	} else if len(problems) != 0 {
		t.Fatalf("unerwartete Probleme: %v", problems)
	}

	problems, err := s.Validate("p", Options{}, []SelectionItem{{BlockID: "b1"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(problems) != 1 {
		t.Fatalf("erwartet genau ein Problem, bekommen %v", problems)
	}
}
