// Package voices scans the local Piper voice directory. A voice consists of
// a model file "<name>.onnx" and its config "<name>.onnx.json".
package voices

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Voice describes one locally installed Piper model.
type Voice struct {
	// Name is the file base name without ".onnx", e.g. "de_DE-thorsten-medium".
	Name string `json:"name"`
	// Language is taken from the model config, e.g. "de_DE".
	Language string `json:"language"`
	// Quality is derived from the file name suffix (low/medium/high/x_low).
	Quality string `json:"quality"`
	// NumSpeakers is 1 for single speaker models.
	NumSpeakers int `json:"numSpeakers"`
	// SpeakerIDs maps a human readable speaker name to its Piper speaker id.
	// Empty for single speaker models.
	SpeakerIDs map[string]int `json:"speakerIds,omitempty"`
	// SampleRate of the model output.
	SampleRate int `json:"sampleRate"`

	modelPath  string
	configPath string
}

// ModelPath returns the absolute path of the .onnx file.
func (v Voice) ModelPath() string { return v.modelPath }

// ConfigPath returns the absolute path of the .onnx.json file.
func (v Voice) ConfigPath() string { return v.configPath }

// ErrNotFound is returned when a requested voice is not installed.
var ErrNotFound = errors.New("voice not found")

// Registry scans and caches the voices directory.
type Registry struct {
	dir string
}

// New returns a registry for the given directory. The directory is created if
// it does not exist yet so a fresh checkout starts cleanly.
func New(dir string) *Registry {
	_ = os.MkdirAll(dir, 0o755)
	return &Registry{dir: dir}
}

// Dir returns the scanned directory (useful for error messages).
func (r *Registry) Dir() string { return r.dir }

// List scans the directory on every call; voice sets are small and this keeps
// newly downloaded models visible without a restart.
func (r *Registry) List() ([]Voice, error) {
	var out []Voice
	err := filepath.WalkDir(r.dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // skip unreadable entries
		}
		if d.IsDir() || !strings.HasSuffix(path, ".onnx") {
			return nil
		}
		cfg := path + ".json"
		if _, err := os.Stat(cfg); err != nil {
			return nil // model without config is unusable
		}
		v := Voice{
			Name:        strings.TrimSuffix(filepath.Base(path), ".onnx"),
			NumSpeakers: 1,
			modelPath:   path,
			configPath:  cfg,
		}
		applyConfig(&v, cfg)
		v.Quality = qualityFromName(v.Name)
		out = append(out, v)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	if out == nil {
		out = []Voice{}
	}
	return out, nil
}

// Get returns a voice by name.
func (r *Registry) Get(name string) (Voice, error) {
	if name == "" {
		return Voice{}, ErrNotFound
	}
	list, err := r.List()
	if err != nil {
		return Voice{}, err
	}
	for _, v := range list {
		if v.Name == name {
			return v, nil
		}
	}
	return Voice{}, fmt.Errorf("%w: %q (erwartet in %s)", ErrNotFound, name, r.dir)
}

// piperConfig mirrors the parts of <model>.onnx.json we care about.
type piperConfig struct {
	Audio struct {
		SampleRate int `json:"sample_rate"`
	} `json:"audio"`
	NumSpeakers  int            `json:"num_speakers"`
	SpeakerIDMap map[string]int `json:"speaker_id_map"`
	Language     struct {
		Code string `json:"code"`
	} `json:"language"`
	Espeak struct {
		Voice string `json:"voice"`
	} `json:"espeak"`
}

func applyConfig(v *Voice, path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var pc piperConfig
	if err := json.Unmarshal(b, &pc); err != nil {
		return
	}
	if pc.Audio.SampleRate > 0 {
		v.SampleRate = pc.Audio.SampleRate
	}
	if pc.NumSpeakers > 0 {
		v.NumSpeakers = pc.NumSpeakers
	}
	if len(pc.SpeakerIDMap) > 0 {
		v.SpeakerIDs = pc.SpeakerIDMap
	}
	switch {
	case pc.Language.Code != "":
		v.Language = pc.Language.Code
	case pc.Espeak.Voice != "":
		v.Language = pc.Espeak.Voice
	default:
		if parts := strings.SplitN(v.Name, "-", 2); len(parts) == 2 {
			v.Language = parts[0]
		}
	}
}

func qualityFromName(name string) string {
	for _, q := range []string{"x_low", "low", "medium", "high"} {
		if strings.HasSuffix(name, "-"+q) {
			return q
		}
	}
	return ""
}
