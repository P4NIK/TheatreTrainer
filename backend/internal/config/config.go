// Package config resolves all runtime paths and external tool settings.
//
// Nothing here is hard-coded to a specific machine: every value has a sane
// relative default and can be overridden through environment variables, so the
// repository can be cloned and run by anyone.
package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds the effective runtime configuration of the server.
type Config struct {
	// Addr is the listen address, e.g. ":8080".
	Addr string
	// DataDir holds user projects (PDFs, JSON, generated audio).
	DataDir string
	// VoicesDir holds the Piper *.onnx / *.onnx.json voice models.
	VoicesDir string
	// PiperCmd is the Piper executable plus any leading arguments,
	// e.g. ["piper"] or ["python", "-m", "piper"]. Empty unless the user set
	// PIPER_BIN – otherwise the command is auto-detected at runtime.
	PiperCmd []string
	// PiperExplicit is true when PIPER_BIN was set, which disables
	// auto-detection so an explicit choice is never silently overridden.
	PiperExplicit bool
	// LengthScaleFlag is the CLI flag name Piper expects for the speaking
	// rate. Older C++ builds use "--length_scale", newer Python builds use
	// "--length-scale".
	LengthScaleFlag string
	// FFmpegBin is used for the optional MP3 export. Empty or missing binary
	// simply means "WAV only".
	FFmpegBin string
	// SampleRate is the sample rate of the concatenated output file. All
	// Piper segments are resampled to it.
	SampleRate int
	// GapMillis is the silence inserted between two blocks.
	GapMillis int
	// SkippedRoleMillis is the pause inserted instead of your own lines.
	SkippedRoleMillis int
}

// Load builds the configuration from the environment, falling back to
// repository-relative defaults.
func Load() *Config {
	root := repoRoot()

	piperBin := env("PIPER_BIN", "")

	c := &Config{
		Addr:              env("THEATER_ADDR", ":8080"),
		DataDir:           env("THEATER_DATA_DIR", filepath.Join(root, "data")),
		VoicesDir:         env("THEATER_VOICES_DIR", filepath.Join(root, "voices")),
		PiperCmd:          strings.Fields(piperBin),
		LengthScaleFlag:   env("PIPER_LENGTH_SCALE_FLAG", "--length-scale"),
		FFmpegBin:         env("FFMPEG_BIN", "ffmpeg"),
		SampleRate:        envInt("THEATER_SAMPLE_RATE", 22050),
		GapMillis:         envInt("THEATER_GAP_MS", 450),
		SkippedRoleMillis: envInt("THEATER_SKIP_PAUSE_MS", 2500),
	}
	c.PiperExplicit = len(c.PiperCmd) > 0
	return c
}

// PiperCandidates lists the commands that are probed when PIPER_BIN is not
// set. `pip install piper-tts` does not always put a `piper` executable on the
// PATH – on Windows the Scripts directory is frequently missing from it – so
// the module invocation is tried as well.
func (c *Config) PiperCandidates() [][]string {
	if c.PiperExplicit {
		return [][]string{c.PiperCmd}
	}
	return [][]string{
		{"piper"},
		{"python", "-m", "piper"},
		{"python3", "-m", "piper"},
		{"py", "-m", "piper"},
	}
}

// ProjectsDir is the parent directory of all project folders.
func (c *Config) ProjectsDir() string { return filepath.Join(c.DataDir, "projects") }

// ProjectDir returns the directory of a single project.
func (c *Config) ProjectDir(id string) string { return filepath.Join(c.ProjectsDir(), id) }

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return def
}

// repoRoot walks up from the working directory looking for the checkout root
// (the directory containing both "backend" and "frontend"). This makes the
// server behave identically whether it is started with
// `go run ./cmd/server` from backend/ or as a built binary from the repo root.
func repoRoot() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	dir := wd
	for i := 0; i < 6; i++ {
		if isDir(filepath.Join(dir, "backend")) && isDir(filepath.Join(dir, "frontend")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return wd
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}
