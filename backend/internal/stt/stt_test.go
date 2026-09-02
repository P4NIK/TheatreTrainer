package stt

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/bloodmage/theater-tts/backend/internal/config"
)

func TestVocabularyIsAHintNotTheSentence(t *testing.T) {
	hint := vocabulary([]string{"HUGO", "SIR ROWLAND", "hugo", " ", "CLARISSA"})

	// Deduplicated case-insensitively and free of blanks.
	if strings.Count(hint, "HUGO") != 1 {
		t.Fatalf("Name doppelt: %q", hint)
	}
	for _, want := range []string{"SIR ROWLAND", "CLARISSA"} {
		if !strings.Contains(hint, want) {
			t.Fatalf("%q fehlt in %q", want, hint)
		}
	}
}

func TestVocabularyStaysShort(t *testing.T) {
	var many []string
	for i := 0; i < 50; i++ {
		many = append(many, string(rune('A'+i%26))+"ROLLE")
	}
	// A long prompt is one the recognizer starts to recite – cap it.
	if n := strings.Count(vocabulary(many), ","); n > 19 {
		t.Fatalf("Hinweis zu lang: %d Namen", n+1)
	}
}

func TestVocabularyIsEmptyWithoutNames(t *testing.T) {
	if got := vocabulary(nil); got != "" {
		t.Fatalf("erwartet leer, bekommen %q", got)
	}
}

func TestReadTranscriptPicksTheTextFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "take.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "take.txt"), []byte(" Guten Abend. \n"), 0o644); err != nil {
		t.Fatal(err)
	}

	text, ok := readTranscript(dir)
	if !ok || text != "Guten Abend." {
		t.Fatalf("erwartet \"Guten Abend.\", bekommen %q (ok=%v)", text, ok)
	}
}

func TestReadTranscriptReportsNothingWhenEmpty(t *testing.T) {
	if _, ok := readTranscript(t.TempDir()); ok {
		t.Fatal("leeres Verzeichnis darf kein Ergebnis liefern")
	}
}

// A custom command line is the escape hatch for engines that do not speak
// Whisper's CLI. This checks the whole path: placeholders, execution, stdout.
func TestTranscribeUsesACustomCommandLine(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Shell-Skript als Ersatz-Engine gibt es hier nicht")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "fake-engine.sh")
	body := "#!/bin/sh\necho \"gehört: $(basename \"$1\")\"\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	audio := filepath.Join(dir, "take.webm")
	if err := os.WriteFile(audio, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	s := New(&config.Config{STTTemplate: script + " {audio}", WhisperModel: "small"})
	if !s.Available() {
		t.Fatal("eine vorgegebene Befehlszeile gilt immer als vorhanden")
	}

	text, err := s.Transcribe(context.Background(), audio, []string{"HUGO"})
	if err != nil {
		t.Fatal(err)
	}
	if text != "gehört: take.webm" {
		t.Fatalf("unerwartete Ausgabe: %q", text)
	}
}

func TestTranscribeReportsAMissingEngine(t *testing.T) {
	s := New(&config.Config{STTCmd: []string{"gibt-es-nicht-12345"}, STTExplicit: true})

	if s.Available() {
		t.Fatal("ein nicht vorhandener Befehl darf nicht als vorhanden gelten")
	}
	_, err := s.Transcribe(context.Background(), "/tmp/x.webm", nil)
	if err == nil || !strings.Contains(err.Error(), "gibt-es-nicht-12345") {
		t.Fatalf("Fehler soll den versuchten Befehl nennen, bekommen: %v", err)
	}
}
