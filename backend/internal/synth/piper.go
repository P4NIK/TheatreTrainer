package synth

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bloodmage/theater-tts/backend/internal/config"
	"github.com/bloodmage/theater-tts/backend/internal/voices"
)

// Piper wraps the locally installed Piper CLI.
//
// The command is not assumed to be a plain `piper` binary: `pip install
// piper-tts` frequently leaves no executable on the PATH (especially on
// Windows), where `python -m piper` is the working invocation. The wrapper
// therefore probes a list of candidates once and remembers what worked.
type Piper struct {
	cfg      *config.Config
	registry *voices.Registry

	mu        sync.Mutex
	found     []string
	tried     []string
	detail    string
	lastProbe time.Time
}

// NewPiper creates the wrapper.
func NewPiper(cfg *config.Config, reg *voices.Registry) *Piper {
	return &Piper{cfg: cfg, registry: reg}
}

// Info describes the detection result for the UI and the startup log.
type Info struct {
	Available bool     `json:"available"`
	Command   string   `json:"command,omitempty"`
	Tried     []string `json:"tried"`
	Explicit  bool     `json:"explicit"`
	Detail    string   `json:"detail,omitempty"`
}

// reprobeAfter is how long a failed detection is cached. Short enough that
// installing Piper while the server runs is picked up by a page reload.
const reprobeAfter = 15 * time.Second

// edgeFadeMillis is the ramp applied at the start and end of every synthesised
// segment. Short enough to be inaudible, long enough to remove clicks.
const edgeFadeMillis = 8

// logPiperCalls mirrors every Piper invocation to the server log, so the
// command the app runs can be compared with a hand-typed one. Enable with
// THEATER_LOG_PIPER=1.
var logPiperCalls = os.Getenv("THEATER_LOG_PIPER") == "1"

// resolve returns the working Piper command, probing if necessary.
func (p *Piper) resolve() ([]string, Info) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.found == nil && time.Since(p.lastProbe) > reprobeAfter {
		p.probeLocked()
	}
	info := Info{
		Available: p.found != nil,
		Tried:     append([]string{}, p.tried...),
		Explicit:  p.cfg.PiperExplicit,
		Detail:    p.detail,
	}
	if p.found != nil {
		info.Command = strings.Join(p.found, " ")
	}
	return p.found, info
}

func (p *Piper) probeLocked() {
	p.lastProbe = time.Now()
	p.tried = nil
	p.detail = ""

	var problems []string
	for _, cand := range p.cfg.PiperCandidates() {
		if len(cand) == 0 {
			continue
		}
		p.tried = append(p.tried, strings.Join(cand, " "))

		if _, err := exec.LookPath(cand[0]); err != nil {
			problems = append(problems, fmt.Sprintf("%s: nicht im PATH", cand[0]))
			continue
		}
		if err := probeCommand(cand); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", strings.Join(cand, " "), err))
			continue
		}
		p.found = cand
		p.detail = ""
		return
	}
	p.found = nil
	p.detail = strings.Join(problems, "; ")
}

// probeCommand runs "<cmd> --help" and accepts anything that looks like the
// Piper usage text, so both the Python and the older C++ build are recognised.
func probeCommand(cmd []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	c := exec.CommandContext(ctx, cmd[0], append(append([]string{}, cmd[1:]...), "--help")...)
	out, err := c.CombinedOutput()
	text := strings.ToLower(string(out))
	looksRight := strings.Contains(text, "--model") || strings.Contains(text, "usage: piper")
	if err == nil || looksRight {
		if err != nil && !looksRight {
			return err
		}
		return nil
	}
	if ctx.Err() != nil {
		return fmt.Errorf("Zeitüberschreitung beim Start")
	}
	return fmt.Errorf("%v (%s)", err, firstLine(text))
}

// Available reports whether a usable Piper command was found.
func (p *Piper) Available() bool {
	cmd, _ := p.resolve()
	return cmd != nil
}

// Info returns the detection result.
func (p *Piper) Info() Info {
	_, info := p.resolve()
	return info
}

// Request is a single synthesis call.
type Request struct {
	Text        string
	Model       string
	SpeakerID   int
	LengthScale float64
	Volume      float64
	// Pitch shifts the voice: 1.0 leaves it alone, 1.1 is roughly a tone
	// higher, 0.9 a tone lower. See the comment on Synthesize for how it
	// works.
	Pitch float64
}

// pitchRange bounds the pitch factor. Beyond roughly ±25 % the formants shift
// so far that the voice turns into a caricature.
const (
	minPitch = 0.75
	maxPitch = 1.30
)

// Synthesize renders one utterance to a temporary WAV file and returns the
// decoded mono samples together with the model's sample rate.
//
// The pitch setting is applied to the finished audio: it is resampled (which
// moves pitch and formants together – that is what makes a voice sound like a
// different person rather than a sped-up tape) and then stretched back to its
// original length, so tempo and pitch stay independent of each other.
func (p *Piper) Synthesize(ctx context.Context, req Request) (segment, error) {
	// Piper treats every stdin line as a separate utterance, so the text is
	// collapsed into a single line before it is handed over.
	text := strings.Join(strings.Fields(req.Text), " ")
	if text == "" {
		return segment{}, nil
	}

	base, info := p.resolve()
	if base == nil {
		return segment{}, fmt.Errorf("Piper wurde nicht gefunden. Versucht: %s. %s",
			strings.Join(info.Tried, ", "), info.Detail)
	}

	voice, err := p.registry.Get(req.Model)
	if err != nil {
		return segment{}, err
	}

	tmpDir, err := os.MkdirTemp("", "theater-tts-")
	if err != nil {
		return segment{}, err
	}
	defer os.RemoveAll(tmpDir)
	outPath := filepath.Join(tmpDir, "line.wav")

	args := append([]string{}, base[1:]...)
	args = append(args,
		"-m", voice.ModelPath(),
		"-c", voice.ConfigPath(),
		"-f", outPath,
	)
	if voice.NumSpeakers > 1 {
		args = append(args, "-s", strconv.Itoa(req.SpeakerID))
	}

	pitch := req.Pitch
	if pitch <= 0 {
		pitch = 1.0
	}
	pitch = math.Max(minPitch, math.Min(maxPitch, pitch))

	if req.LengthScale > 0 && req.LengthScale != 1.0 {
		args = append(args, p.cfg.LengthScaleFlag, formatFloat(req.LengthScale))
	}

	if logPiperCalls {
		log.Printf("piper: %s  <<< %q", strings.Join(append([]string{base[0]}, args...), " "), text)
	}

	cmd := exec.CommandContext(ctx, base[0], args...)
	cmd.Env = utf8Env()
	cmd.Stdin = strings.NewReader(text + "\n")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &bytes.Buffer{}

	if err := cmd.Run(); err != nil {
		return segment{}, fmt.Errorf("Piper-Aufruf fehlgeschlagen (%s): %w\n%s",
			strings.Join(append([]string{base[0]}, args...), " "), err, tail(stderr.String()))
	}
	if _, err := os.Stat(outPath); err != nil {
		return segment{}, fmt.Errorf("Piper hat keine Ausgabedatei geschrieben:\n%s", tail(stderr.String()))
	}

	seg, err := readWAVMono(outPath)
	if err != nil {
		return segment{}, err
	}
	if req.Volume > 0 && req.Volume != 1.0 {
		seg.samples = applyVolume(seg.samples, req.Volume)
	}

	// Pitch is applied here rather than through Piper: the CLI has no pitch
	// option, and its length scale turned out not to change the duration
	// proportionally, so it cannot be used to compensate either.
	if pitch != 1.0 {
		seg.samples = pitchShift(seg.samples, seg.sampleRate, pitch)
	}

	// Clean up the joins: several voices carry a DC offset, and a segment that
	// starts or ends mid-waveform clicks against the surrounding silence.
	seg.samples = fadeEdges(removeDCOffset(seg.samples), seg.sampleRate, edgeFadeMillis)
	return seg, nil
}

// utf8Env returns the parent environment with Python forced into UTF-8 mode.
//
// The text is handed to Piper on stdin as UTF-8. Python, however, decodes
// stdin with the system's locale encoding – on a German Windows that is
// cp1252, not UTF-8. "Hörprobe" then arrives as "HÃ¶rprobe", and since espeak
// pronounces stray symbols by name, the voice reads "A Tilde" for Ã and
// "Absatz" for ¶ instead of the umlaut. These two variables make Python decode
// stdin as UTF-8 regardless of the machine's locale; a native Piper build
// ignores them.
func utf8Env() []string {
	env := os.Environ()
	out := make([]string, 0, len(env)+2)
	for _, kv := range env {
		if strings.HasPrefix(kv, "PYTHONUTF8=") || strings.HasPrefix(kv, "PYTHONIOENCODING=") {
			continue // never let a stale setting win over ours
		}
		out = append(out, kv)
	}
	return append(out, "PYTHONUTF8=1", "PYTHONIOENCODING=utf-8")
}

func formatFloat(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// tail keeps error output readable in the UI.
func tail(s string) string {
	s = strings.TrimSpace(s)
	const max = 1200
	if len(s) > max {
		return "…" + s[len(s)-max:]
	}
	return s
}
