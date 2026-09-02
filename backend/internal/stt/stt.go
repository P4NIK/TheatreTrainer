// Package stt turns a recording of your own line into text.
//
// It is optional in exactly the way Piper is not: without it the rehearsal
// still works, you just do not get the comparison. The engine is an external
// command that is probed once, so nothing has to be configured on a machine
// where Whisper happens to be installed – and nothing breaks on one where it
// is not.
//
// Deliberately *not* passed to the recogniser: the sentence that is expected.
// Whisper takes an `--initial_prompt` and follows it closely; feeding it the
// line would make it write down the line no matter what was said, and a
// comparison that always agrees is worse than none. Only the character names
// go in – those are proper nouns no recogniser can guess, and knowing them
// does not tell it what the sentence was.
package stt

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/bloodmage/theater-tts/backend/internal/config"
)

// Info describes the detection result for the UI and the startup log.
type Info struct {
	Available bool     `json:"available"`
	Command   string   `json:"command,omitempty"`
	Tried     []string `json:"tried"`
	Explicit  bool     `json:"explicit"`
	Model     string   `json:"model,omitempty"`
	Detail    string   `json:"detail,omitempty"`
}

// reprobeAfter caches a failed detection just long enough that installing
// Whisper while the server runs is picked up by a page reload.
const reprobeAfter = 15 * time.Second

// Service wraps the locally installed speech recognition CLI.
type Service struct {
	cfg *config.Config

	mu        sync.Mutex
	found     []string
	tried     []string
	detail    string
	lastProbe time.Time
}

func New(cfg *config.Config) *Service { return &Service{cfg: cfg} }

// Info reports what was detected without running anything.
func (s *Service) Info() Info {
	_, info := s.resolve()
	return info
}

// Available reports whether a usable command was found.
func (s *Service) Available() bool {
	cmd, _ := s.resolve()
	return cmd != nil || s.cfg.STTTemplate != ""
}

func (s *Service) resolve() ([]string, Info) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if tpl := s.cfg.STTTemplate; tpl != "" {
		// A full command line was given – it is used as is, no probing.
		return nil, Info{
			Available: true,
			Command:   tpl,
			Tried:     []string{tpl},
			Explicit:  true,
			Model:     s.cfg.WhisperModel,
		}
	}
	if s.found == nil && time.Since(s.lastProbe) > reprobeAfter {
		s.probeLocked()
	}
	info := Info{
		Available: s.found != nil,
		Tried:     append([]string{}, s.tried...),
		Explicit:  s.cfg.STTExplicit,
		Model:     s.cfg.WhisperModel,
		Detail:    s.detail,
	}
	if s.found != nil {
		info.Command = strings.Join(s.found, " ")
	}
	return s.found, info
}

func (s *Service) probeLocked() {
	s.lastProbe = time.Now()
	s.tried = nil
	s.detail = ""

	var problems []string
	for _, cand := range s.cfg.STTCandidates() {
		if len(cand) == 0 {
			continue
		}
		s.tried = append(s.tried, strings.Join(cand, " "))

		if _, err := exec.LookPath(cand[0]); err != nil {
			problems = append(problems, fmt.Sprintf("%s: nicht im PATH", cand[0]))
			continue
		}
		if err := probeCommand(cand); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", strings.Join(cand, " "), err))
			continue
		}
		s.found = cand
		s.detail = ""
		return
	}
	s.found = nil
	s.detail = strings.Join(problems, "; ")
}

func probeCommand(cmd []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	c := exec.CommandContext(ctx, cmd[0], append(append([]string{}, cmd[1:]...), "--help")...)
	c.Env = utf8Env()
	out, err := c.CombinedOutput()
	text := strings.ToLower(string(out))
	// Importing torch takes a while and prints warnings; the help text is the
	// reliable signal, not the exit code.
	looksRight := strings.Contains(text, "--model") && strings.Contains(text, "--language")
	if looksRight {
		return nil
	}
	if err == nil {
		return fmt.Errorf("Hilfetext sieht nicht nach Whisper aus")
	}
	if ctx.Err() != nil {
		return fmt.Errorf("Zeitüberschreitung beim Start")
	}
	return fmt.Errorf("%v (%s)", err, firstLine(text))
}

// logCalls mirrors every invocation to the server log.
var logCalls = os.Getenv("THEATER_LOG_STT") != ""

// Transcribe runs the recognizer on an audio file and returns the plain text.
//
// `names` are the character names of the play; they are handed over as a
// vocabulary hint. See the package comment for why the expected line is not.
func (s *Service) Transcribe(ctx context.Context, audioPath string, names []string) (string, error) {
	cmd, info := s.resolve()
	if !info.Available {
		return "", fmt.Errorf(
			"keine Spracherkennung gefunden. Versucht: %s. %s",
			strings.Join(info.Tried, ", "), info.Detail)
	}

	outDir, err := os.MkdirTemp("", "theater-stt-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(outDir)

	var args []string
	if tpl := s.cfg.STTTemplate; tpl != "" {
		fields := strings.Fields(tpl)
		for _, f := range fields {
			f = strings.ReplaceAll(f, "{audio}", audioPath)
			f = strings.ReplaceAll(f, "{out}", outDir)
			f = strings.ReplaceAll(f, "{model}", s.cfg.WhisperModel)
			args = append(args, f)
		}
	} else {
		args = append(args, cmd...)
		args = append(args,
			audioPath,
			"--model", s.cfg.WhisperModel,
			"--language", "de",
			"--task", "transcribe",
			"--output_format", "txt",
			"--output_dir", outDir,
			// Running on the CPU without this prints a warning and falls back
			// anyway; saying it outright keeps the log readable.
			"--fp16", "False",
		)
		if hint := vocabulary(names); hint != "" {
			args = append(args, "--initial_prompt", hint)
		}
	}

	if logCalls {
		log.Printf("STT: %s", strings.Join(args, " "))
	}

	run := exec.CommandContext(ctx, args[0], args[1:]...)
	run.Env = utf8Env()
	out, err := run.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("Spracherkennung fehlgeschlagen: %v (%s)", err, tail(string(out)))
	}

	// The custom template prints to stdout, Whisper writes a .txt next to the
	// audio file. Prefer the file when there is one.
	if text, ok := readTranscript(outDir); ok {
		return text, nil
	}
	return strings.TrimSpace(string(out)), nil
}

func readTranscript(dir string) (string, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".txt") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		return strings.TrimSpace(string(data)), true
	}
	return "", false
}

// vocabulary builds the hint from the character names, capped so it cannot
// become a prompt the recognizer starts to recite.
func vocabulary(names []string) string {
	seen := map[string]bool{}
	var out []string
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[strings.ToLower(n)] {
			continue
		}
		seen[strings.ToLower(n)] = true
		out = append(out, n)
		if len(out) == 20 {
			break
		}
	}
	if len(out) == 0 {
		return ""
	}
	return "Theaterstück. Personen: " + strings.Join(out, ", ") + "."
}

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

func firstLine(s string) string {
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return s[:i]
	}
	return s
}

func tail(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 400 {
		return "…" + s[len(s)-400:]
	}
	return s
}
