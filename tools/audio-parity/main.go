package main

// Faehrt die DSP-Funktionen aus audio.go ueber einen festen Satz Eingaben und
// schreibt jedes Ergebnis als rohes int16-LE. Die TypeScript-Portierung
// bekommt dieselben Eingaben und muss dieselben Dateien erzeugen.

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
)

const rate = 22050

func sine(rate int, freq float64, n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = int(math.Round(9000 * math.Sin(2*math.Pi*freq*float64(i)/float64(rate))))
	}
	return out
}

// speech liest das rohe PCM aus einer WAV-Datei, indem es den 44-Byte-Kopf
// ueberspringt - reicht fuer die kanonischen Dateien, die Piper schreibt.
func speech(path string) []int {
	raw, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	body := raw[44:]
	out := make([]int, len(body)/2)
	for i := range out {
		out[i] = int(int16(binary.LittleEndian.Uint16(body[2*i:])))
	}
	return out
}

func copyOf(x []int) []int { return append([]int(nil), x...) }

func write(dir, name string, samples []int) {
	buf := make([]byte, 2*len(samples))
	for i, s := range samples {
		binary.LittleEndian.PutUint16(buf[2*i:], uint16(int16(s)))
	}
	if err := os.WriteFile(filepath.Join(dir, name+".pcm"), buf, 0o644); err != nil {
		panic(err)
	}
}

type Case struct {
	Name string `json:"name"`
	Fn   string `json:"fn"`
	In   string `json:"in"`
	Args []any  `json:"args"`
	Out  int    `json:"outLen"`
}

func main() {
	outDir := os.Args[1]
	wav := os.Args[2]
	os.MkdirAll(outDir, 0o755)

	inputs := map[string][]int{
		"sine180": sine(rate, 180, rate),
		"sine110": sine(rate, 110, rate),
		"speech":  speech(wav),
		"dc": func() []int {
			s := sine(rate, 200, rate/2)
			for i := range s {
				s[i] += 900
			}
			return s
		}(),
		"short":   sine(rate, 300, 500),
		"tiny":    {0, 1000, -1000, 32767, -32768, 0},
		"empty":   {},
		"toneSil": append(sine(rate, 200, rate*8/10), make([]int, rate*2/10)...),
	}
	for name, s := range inputs {
		write(outDir, "in_"+name, s)
	}

	var cases []Case
	run := func(name, fn, in string, args []any, samples []int) {
		write(outDir, name, samples)
		cases = append(cases, Case{name, fn, in, args, len(samples)})
	}

	for _, in := range []string{"sine180", "speech", "tiny", "empty", "short"} {
		x := inputs[in]
		for _, target := range []int{16000, 22050, 24255, 44100} {
			run("resample_"+in+"_"+itoa(target), "resample", in, []any{rate, target},
				resample(segment{samples: copyOf(x), sampleRate: rate}, target))
		}
	}
	for _, in := range []string{"dc", "sine180", "speech", "tiny", "empty"} {
		run("dc_"+in, "removeDCOffset", in, nil, removeDCOffset(copyOf(inputs[in])))
	}
	for _, in := range []string{"sine180", "speech", "tiny", "short", "empty"} {
		for _, ms := range []int{8, 20} {
			run("fade_"+in+"_"+itoa(ms), "fadeEdges", in, []any{rate, ms},
				fadeEdges(copyOf(inputs[in]), rate, ms))
		}
	}
	for _, in := range []string{"sine180", "speech", "tiny"} {
		for _, v := range []float64{0.5, 1.0, 2.0, 0} {
			run("vol_"+in+"_"+ftoa(v), "applyVolume", in, []any{v}, applyVolume(copyOf(inputs[in]), v))
		}
	}
	for _, ms := range []int{450, 2500, 1, 0} {
		run("silence_"+itoa(ms), "silence", "", []any{ms, rate}, silence(ms, rate))
	}
	for _, in := range []string{"sine180", "speech", "toneSil", "short"} {
		for _, s := range []float64{0.8, 1.2, 1.4, 0.84} {
			run("stretch_"+in+"_"+ftoa(s), "timeStretch", in, []any{rate, s},
				timeStretch(copyOf(inputs[in]), rate, s))
		}
	}
	for _, in := range []string{"sine110", "speech", "short"} {
		for _, p := range []float64{0.85, 1.0, 1.15, 1.25, 0.75, 1.3} {
			run("pitch_"+in+"_"+ftoa(p), "pitchShift", in, []any{rate, p},
				pitchShift(copyOf(inputs[in]), rate, p))
		}
	}
	// Die Kette, die postProcess in piper.go tatsaechlich faehrt.
	for _, in := range []string{"speech", "sine180"} {
		for _, c := range [][2]float64{{0.8, 1.1}, {1.2, 0.9}, {1.0, 1.25}} {
			s := copyOf(inputs[in])
			s = applyVolume(s, c[0])
			s = pitchShift(s, rate, c[1])
			s = fadeEdges(removeDCOffset(s), rate, 8)
			run("chain_"+in+"_"+ftoa(c[0])+"_"+ftoa(c[1]), "postProcess", in, []any{c[0], c[1]}, s)
		}
	}

	j, _ := json.MarshalIndent(cases, "", " ")
	os.WriteFile(filepath.Join(outDir, "cases.json"), j, 0o644)
	println(len(cases), "Faelle geschrieben")
}

func itoa(v int) string { b, _ := json.Marshal(v); return string(b) }
func ftoa(v float64) string {
	b, _ := json.Marshal(v)
	s := string(b)
	out := []byte{}
	for i := 0; i < len(s); i++ {
		if s[i] == '.' {
			out = append(out, 'p')
		} else {
			out = append(out, s[i])
		}
	}
	return string(out)
}
