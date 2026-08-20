package synth

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResampleChangesLengthProportionally(t *testing.T) {
	in := segment{samples: make([]int, 16000), sampleRate: 16000}
	out := resample(in, 22050)
	if got, want := len(out), 22050; got < want-2 || got > want+2 {
		t.Fatalf("resample: got %d samples, want ~%d", got, want)
	}
	if same := resample(in, 16000); len(same) != len(in.samples) {
		t.Fatalf("resample to same rate must be a no-op")
	}
}

func TestApplyVolumeClips(t *testing.T) {
	got := applyVolume([]int{30000, -30000, 0}, 2.0)
	if got[0] != 32767 || got[1] != -32768 {
		t.Fatalf("applyVolume must clip to int16 range, got %v", got)
	}
	if got[2] != 0 {
		t.Fatalf("silence must stay silent, got %d", got[2])
	}
	if muted := applyVolume([]int{1000}, 0); muted[0] != 0 {
		t.Fatalf("volume 0 must mute, got %d", muted[0])
	}
}

func TestSilenceLength(t *testing.T) {
	if got := len(silence(450, 22050)); got != 9922 {
		t.Fatalf("silence(450ms@22050) = %d samples, want 9922", got)
	}
}

func TestWriteAndReadWAVRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.wav")
	samples := []int{0, 1000, -1000, 32767, -32768, 0}

	if err := writeWAV(path, samples, 22050); err != nil {
		t.Fatalf("writeWAV: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("output file missing: %v", err)
	}

	seg, err := readWAVMono(path)
	if err != nil {
		t.Fatalf("readWAVMono: %v", err)
	}
	if seg.sampleRate != 22050 {
		t.Fatalf("sample rate = %d, want 22050", seg.sampleRate)
	}
	if len(seg.samples) != len(samples) {
		t.Fatalf("got %d samples, want %d", len(seg.samples), len(samples))
	}
	for i := range samples {
		if seg.samples[i] != samples[i] {
			t.Fatalf("sample %d = %d, want %d", i, seg.samples[i], samples[i])
		}
	}
}
