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

// lanczosLobes controls the width of the resampling kernel. Four lobes are a
// good trade-off between sharpness and cost for speech.
const lanczosLobes = 4

// resample converts a segment to the target sample rate.
//
// Piper voices come in different sample rates, and the pitch feature
// deliberately misdeclares a segment's rate to shift it – so this runs on
// nearly every block. It uses a band-limited windowed-sinc (Lanczos) kernel
// rather than linear interpolation: linear interpolation acts as a crude
// low-pass and audibly dulls sibilants, the range that carries speech
// intelligibility.
func resample(seg segment, target int) []int {
	if seg.sampleRate == target || seg.sampleRate == 0 || len(seg.samples) == 0 {
		return seg.samples
	}
	ratio := float64(target) / float64(seg.sampleRate)
	outLen := int(float64(len(seg.samples)) * ratio)
	if outLen <= 0 {
		return nil
	}

	// When downsampling, the kernel is widened so it also low-passes at the
	// new Nyquist frequency and does not alias.
	scale := math.Min(1, ratio)
	halfWidth := float64(lanczosLobes) / scale
	last := len(seg.samples) - 1

	out := make([]int, outLen)
	for i := range out {
		center := float64(i) / ratio
		from := int(math.Ceil(center - halfWidth))
		to := int(math.Floor(center + halfWidth))

		var sum, norm float64
		for j := from; j <= to; j++ {
			k := j
			if k < 0 {
				k = 0
			} else if k > last {
				k = last
			}
			w := lanczos((center - float64(j)) * scale)
			sum += float64(seg.samples[k]) * w
			norm += w
		}
		if norm != 0 {
			sum /= norm
		}
		out[i] = clampInt16(sum)
	}
	return out
}

func lanczos(x float64) float64 {
	if x == 0 {
		return 1
	}
	if math.Abs(x) >= lanczosLobes {
		return 0
	}
	px := math.Pi * x
	return lanczosLobes * math.Sin(px) * math.Sin(px/lanczosLobes) / (px * px)
}

func clampInt16(v float64) int {
	r := math.Round(v)
	if r > math.MaxInt16 {
		return math.MaxInt16
	}
	if r < math.MinInt16 {
		return math.MinInt16
	}
	return int(r)
}

// removeDCOffset subtracts the mean value of the segment.
//
// Several Piper voices carry a noticeable DC offset – the German MLS models
// sit up to 3 % of full scale away from zero. The offset itself is inaudible,
// but it means the waveform jumps from that value to zero wherever a segment
// meets the silence between two blocks, which is heard as a click.
func removeDCOffset(samples []int) []int {
	if len(samples) == 0 {
		return samples
	}
	var sum int64
	for _, s := range samples {
		sum += int64(s)
	}
	offset := float64(sum) / float64(len(samples))
	if math.Abs(offset) < 1 {
		return samples
	}
	for i, s := range samples {
		samples[i] = clampInt16(float64(s) - offset)
	}
	return samples
}

// fadeEdges ramps the first and last few milliseconds in and out so a segment
// always starts and ends at zero. Together with removeDCOffset this keeps the
// joins between blocks silent.
func fadeEdges(samples []int, sampleRate, ms int) []int {
	n := sampleRate * ms / 1000
	if n <= 0 || len(samples) < 2*n {
		return samples
	}
	for i := 0; i < n; i++ {
		g := float64(i) / float64(n)
		samples[i] = clampInt16(float64(samples[i]) * g)
		j := len(samples) - 1 - i
		samples[j] = clampInt16(float64(samples[j]) * g)
	}
	return samples
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
		samples[i] = clampInt16(float64(s) * volume)
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

// timeStretch changes the length of a segment by the factor s without moving
// its pitch, using WSOLA (waveform similarity overlap-add): overlapping frames
// are laid down at the new spacing, and each frame is picked from a small
// search window around its ideal position so that it continues the previous
// one as smoothly as possible. That alignment is what keeps the periodicity –
// and therefore the pitch – intact.
func timeStretch(x []int, rate int, s float64) []int {
	if len(x) == 0 || s <= 0 || math.Abs(s-1) < 1e-6 {
		return x
	}
	frame := rate * 40 / 1000 // 40 ms holds several pitch periods
	if frame%2 == 1 {
		frame++
	}
	if len(x) < 3*frame {
		return x // too short to stretch without artefacts
	}
	hop := frame / 2 // Hann windows at half a frame sum to one
	search := frame / 4

	win := make([]float64, frame)
	for i := range win {
		win[i] = 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/float64(frame))
	}

	outLen := int(float64(len(x)) * s)
	acc := make([]float64, outLen+frame)
	weight := make([]float64, outLen+frame)

	var template []int // how the previous frame would have continued naturally

	for n := 0; ; n++ {
		out := n * hop
		if out+frame > outLen {
			break
		}
		// The ideal position is computed from the frame index, never from the
		// previous match. Advancing from the match instead would let the
		// search offset accumulate: the analysis would creep backwards and
		// the tail of the input would never be reached, cutting off the end.
		ideal := int(math.Round(float64(n) * float64(hop) / s))

		start := ideal
		if template != nil {
			start = bestMatch(x, template, ideal, search)
		}
		if start+frame > len(x) {
			start = len(x) - frame
		}
		if start < 0 {
			start = 0
		}

		for i := 0; i < frame; i++ {
			acc[out+i] += float64(x[start+i]) * win[i]
			weight[out+i] += win[i]
		}

		if next := start + hop; next+frame <= len(x) {
			template = x[next : next+frame]
		} else {
			template = nil
		}
	}

	result := make([]int, outLen)
	for i := range result {
		if weight[i] > 1e-6 {
			result[i] = clampInt16(acc[i] / weight[i])
		}
	}
	return result
}

// bestMatch returns the offset near ideal whose samples continue the template
// most smoothly.
func bestMatch(x, template []int, ideal, search int) int {
	frame := len(template)
	from := ideal - search
	if from < 0 {
		from = 0
	}
	to := ideal + search
	if to+frame > len(x) {
		to = len(x) - frame
	}
	if to < from {
		return ideal
	}

	best, bestScore := from, math.Inf(-1)
	for cand := from; cand <= to; cand++ {
		var dot, energy float64
		// A coarse stride is plenty: we are looking for the alignment of pitch
		// periods, not for sample-exact similarity.
		for i := 0; i < frame; i += 4 {
			v := float64(x[cand+i])
			dot += v * float64(template[i])
			energy += v * v
		}
		// Normalising by the candidate's energy matters: a plain dot product
		// prefers whatever is loudest, which drags the search towards the
		// louder middle of an utterance and away from its quiet ending.
		score := dot / math.Sqrt(energy+1)
		if score > bestScore {
			best, bestScore = cand, score
		}
	}
	return best
}

// pitchShift moves a segment's pitch and formants by the given factor while
// keeping its duration. Resampling alone would shorten the segment; the
// time stretch undoes exactly that.
func pitchShift(samples []int, rate int, pitch float64) []int {
	if len(samples) == 0 || pitch <= 0 || math.Abs(pitch-1) < 1e-6 {
		return samples
	}
	shifted := resample(segment{samples: samples, sampleRate: int(math.Round(float64(rate) * pitch))}, rate)
	return timeStretch(shifted, rate, pitch)
}

// encodeWAV writes samples to a temporary file and returns the bytes. The WAV
// encoder needs an io.WriteSeeker, which a plain buffer is not.
func encodeWAV(samples []int, sampleRate int) ([]byte, error) {
	tmp, err := os.CreateTemp("", "theater-*.wav")
	if err != nil {
		return nil, err
	}
	path := tmp.Name()
	tmp.Close()
	defer os.Remove(path)

	if err := writeWAV(path, samples, sampleRate); err != nil {
		return nil, err
	}
	return os.ReadFile(path)
}
