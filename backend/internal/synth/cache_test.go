package synth

import (
	"path/filepath"
	"testing"
)

func TestKeyCoversWhatPiperSees(t *testing.T) {
	base := Request{Text: "Guten Abend.", Model: "de_DE-thorsten-medium", SpeakerID: 0, LengthScale: 1, Volume: 1, Pitch: 1}

	same := []struct {
		name string
		req  Request
	}{
		{"gleicher Text anders formatiert", withText(base, "  Guten   Abend.\n")},
		{"andere Lautstärke", withVolume(base, 0.7)},
		{"andere Tonhöhe", withPitch(base, 1.2)},
	}
	for _, c := range same {
		if Key(c.req) != Key(base) {
			t.Errorf("%s: Schlüssel hat sich geändert, obwohl Piper dieselbe Ausgabe liefert", c.name)
		}
	}

	different := []struct {
		name string
		req  Request
	}{
		{"anderer Text", withText(base, "Guten Morgen.")},
		{"anderes Modell", withModel(base, "de_DE-mls-medium")},
		{"andere Stimme", withSpeaker(base, 36)},
		{"anderes Tempo", withLength(base, 1.2)},
	}
	for _, c := range different {
		if Key(c.req) == Key(base) {
			t.Errorf("%s: Schlüssel ist gleich geblieben, obwohl Piper anders klingt", c.name)
		}
	}
}

func TestCacheRoundTrip(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "cache")
	c := NewCache(dir)

	if _, ok := c.Get("fehlt"); ok {
		t.Fatal("leerer Zwischenspeicher darf nichts liefern")
	}

	seg := segment{samples: []int{0, 1000, -1000, 500}, sampleRate: 22050}
	if err := c.Put("abc", seg); err != nil {
		t.Fatalf("Put: %v", err)
	}

	got, ok := c.Get("abc")
	if !ok {
		t.Fatal("gerade gespeicherter Eintrag fehlt")
	}
	if got.sampleRate != seg.sampleRate || len(got.samples) != len(seg.samples) {
		t.Fatalf("Eintrag kam verändert zurück: %+v", got)
	}
	for i := range seg.samples {
		if got.samples[i] != seg.samples[i] {
			t.Fatalf("Sample %d = %d, erwartet %d", i, got.samples[i], seg.samples[i])
		}
	}

	if files, bytes := c.Stats(); files != 1 || bytes == 0 {
		t.Fatalf("Stats: %d Dateien, %d Bytes", files, bytes)
	}
}

func TestCacheKeepOnlyRemovesOrphans(t *testing.T) {
	c := NewCache(filepath.Join(t.TempDir(), "cache"))
	seg := segment{samples: []int{1, 2, 3}, sampleRate: 22050}
	for _, k := range []string{"a", "b", "c"} {
		if err := c.Put(k, seg); err != nil {
			t.Fatal(err)
		}
	}

	if removed := c.KeepOnly(map[string]bool{"a": true, "c": true}); removed != 1 {
		t.Fatalf("%d Dateien entfernt, erwartet 1", removed)
	}
	if _, ok := c.Get("b"); ok {
		t.Error("verwaister Eintrag ist noch da")
	}
	if _, ok := c.Get("a"); !ok {
		t.Error("referenzierter Eintrag wurde entfernt")
	}
	if files, _ := c.Stats(); files != 2 {
		t.Errorf("%d Dateien übrig, erwartet 2", files)
	}
}

func TestPostProcessLeavesTheCachedSegmentAlone(t *testing.T) {
	raw := segment{samples: sine(22050, 200, 4410), sampleRate: 22050}
	before := append([]int(nil), raw.samples...)

	postProcess(raw, Request{Volume: 0.5, Pitch: 1.15, LengthScale: 1})

	for i := range before {
		if raw.samples[i] != before[i] {
			t.Fatal("postProcess hat das zwischengespeicherte Segment verändert")
		}
	}
}

func withText(r Request, t string) Request    { r.Text = t; return r }
func withModel(r Request, m string) Request   { r.Model = m; return r }
func withSpeaker(r Request, id int) Request   { r.SpeakerID = id; return r }
func withLength(r Request, v float64) Request { r.LengthScale = v; return r }
func withVolume(r Request, v float64) Request { r.Volume = v; return r }
func withPitch(r Request, v float64) Request  { r.Pitch = v; return r }
