package synth

import (
	"math"
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

// TestTimeStretchKeepsPitch checks the WSOLA stretcher on its own: the length
// must change by the given factor while the frequency stays put.
func TestTimeStretchKeepsPitch(t *testing.T) {
	const rate = 22050
	for _, s := range []float64{0.8, 1.2, 1.4} {
		in := sine(rate, 180, rate) // one second at 180 Hz
		out := timeStretch(in, rate, s)

		want := int(float64(len(in)) * s)
		if rel := math.Abs(float64(len(out)-want)) / float64(want); rel > 0.02 {
			t.Errorf("Faktor %.1f: %d Samples, erwartet %d", s, len(out), want)
		}
		if got := dominantFreq(out, rate); math.Abs(got-180)/180 > 0.02 {
			t.Errorf("Faktor %.1f: Frequenz %.1f Hz, erwartet 180 Hz", s, got)
		}
	}
}

// TestPitchShiftMovesPitchNotDuration is the regression test for the pitch
// setting: the frequency must move by exactly the chosen factor, and the
// duration must not move at all.
func TestPitchShiftMovesPitchNotDuration(t *testing.T) {
	const (
		rate = 22050
		freq = 110.0 // a low male fundamental
	)
	for _, pitch := range []float64{0.85, 1.0, 1.15, 1.25} {
		in := sine(rate, freq, rate)
		out := pitchShift(in, rate, pitch)

		if rel := math.Abs(float64(len(out)-len(in))) / float64(len(in)); rel > 0.03 {
			t.Errorf("pitch %.2f: Dauer um %.1f %% verändert, erwartet unverändert", pitch, rel*100)
		}
		got, want := dominantFreq(out, rate), freq*pitch
		if rel := math.Abs(got-want) / want; rel > 0.02 {
			t.Errorf("pitch %.2f: Grundfrequenz %.1f Hz, erwartet %.1f Hz (%.1f %% daneben)",
				pitch, got, want, rel*100)
		}
	}
}

func sine(rate int, freq float64, n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = int(math.Round(9000 * math.Sin(2*math.Pi*freq*float64(i)/float64(rate))))
	}
	return out
}

// dominantFreq finds the strongest frequency via the autocorrelation peak.
func dominantFreq(samples []int, rate int) float64 {
	n := 4096
	if len(samples) < n {
		n = len(samples)
	}
	x := make([]float64, n)
	var mean float64
	for i := 0; i < n; i++ {
		mean += float64(samples[i])
	}
	mean /= float64(n)
	for i := 0; i < n; i++ {
		x[i] = float64(samples[i]) - mean
	}

	best, bestLag := 0.0, 0
	for lag := rate / 400; lag < rate/60 && lag < n; lag++ {
		var sum float64
		for i := 0; i+lag < n; i++ {
			sum += x[i] * x[i+lag]
		}
		if sum > best {
			best, bestLag = sum, lag
		}
	}
	if bestLag == 0 {
		return 0
	}
	return float64(rate) / float64(bestLag)
}
