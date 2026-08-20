package synth

import (
	"fmt"
	"math"
	"os"

	"github.com/go-audio/audio"
	"github.com/go-audio/wav"
)

// segment is a chunk of mono 16-bit PCM at a known sample rate.
type segment struct {
	samples    []int
	sampleRate int
}

// readWAVMono decodes a WAV file into mono samples. Piper writes mono files,
// but multi-channel input is downmixed defensively.
func readWAVMono(path string) (segment, error) {
	f, err := os.Open(path)
	if err != nil {
		return segment{}, err
	}
	defer f.Close()

	dec := wav.NewDecoder(f)
	buf, err := dec.FullPCMBuffer()
	if err != nil {
		return segment{}, fmt.Errorf("WAV %s konnte nicht gelesen werden: %w", path, err)
	}
	if buf == nil || buf.Format == nil {
		return segment{}, fmt.Errorf("WAV %s enthält keine Audiodaten", path)
	}

	rate := buf.Format.SampleRate
	channels := buf.Format.NumChannels
	if channels <= 1 {
		return segment{samples: buf.Data, sampleRate: rate}, nil
	}

	mono := make([]int, 0, len(buf.Data)/channels)
	for i := 0; i+channels <= len(buf.Data); i += channels {
		sum := 0
		for c := 0; c < channels; c++ {
			sum += buf.Data[i+c]
		}
		mono = append(mono, sum/channels)
	}
	return segment{samples: mono, sampleRate: rate}, nil
}

// resample converts a segment to the target sample rate using linear
// interpolation. That is more than good enough for rehearsal audio and keeps
// the project free of native resampling dependencies.
func resample(seg segment, target int) []int {
	if seg.sampleRate == target || seg.sampleRate == 0 || len(seg.samples) == 0 {
		return seg.samples
	}
	ratio := float64(target) / float64(seg.sampleRate)
	outLen := int(float64(len(seg.samples)) * ratio)
	if outLen <= 0 {
		return nil
	}
	out := make([]int, outLen)
	for i := 0; i < outLen; i++ {
		src := float64(i) / ratio
		i0 := int(src)
		if i0 >= len(seg.samples)-1 {
			out[i] = seg.samples[len(seg.samples)-1]
			continue
		}
		frac := src - float64(i0)
		a := float64(seg.samples[i0])
		b := float64(seg.samples[i0+1])
		out[i] = int(math.Round(a + (b-a)*frac))
	}
	return out
}

// applyVolume scales samples with clipping protection. Volume 1.0 is a no-op.
func applyVolume(samples []int, volume float64) []int {
	if volume == 1.0 || volume <= 0 {
		if volume <= 0 {
			return make([]int, len(samples))
		}
		return samples
	}
	for i, s := range samples {
		v := int(math.Round(float64(s) * volume))
		if v > math.MaxInt16 {
			v = math.MaxInt16
		} else if v < math.MinInt16 {
			v = math.MinInt16
		}
		samples[i] = v
	}
	return samples
}

// silence returns a block of silent samples of the given duration.
func silence(ms, sampleRate int) []int {
	n := sampleRate * ms / 1000
	if n <= 0 {
		return nil
	}
	return make([]int, n)
}

// writeWAV writes mono 16-bit PCM to disk.
func writeWAV(path string, samples []int, sampleRate int) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	enc := wav.NewEncoder(f, sampleRate, 16, 1, 1)
	buf := &audio.IntBuffer{
		Format:         &audio.Format{NumChannels: 1, SampleRate: sampleRate},
		Data:           samples,
		SourceBitDepth: 16,
	}
	if err := enc.Write(buf); err != nil {
		enc.Close()
		f.Close()
		return err
	}
	if err := enc.Close(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
