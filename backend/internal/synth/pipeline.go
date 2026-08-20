package synth

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/bloodmage/theater-tts/backend/internal/config"
	"github.com/bloodmage/theater-tts/backend/internal/project"
	"github.com/bloodmage/theater-tts/backend/internal/voices"
)

// Service ties together project data, Piper and the job registry.
type Service struct {
	cfg      *config.Config
	store    *project.Store
	registry *voices.Registry
	piper    *Piper
	Jobs     *Jobs
}

// NewService builds the synthesis service.
func NewService(cfg *config.Config, store *project.Store, reg *voices.Registry) *Service {
	return &Service{
		cfg:      cfg,
		store:    store,
		registry: reg,
		piper:    NewPiper(cfg, reg),
		Jobs:     NewJobs(),
	}
}

// PiperAvailable reports whether the Piper CLI was found.
func (s *Service) PiperAvailable() bool { return s.piper.Available() }

// PiperInfo describes which command was detected and what was tried.
func (s *Service) PiperInfo() Info { return s.piper.Info() }

// Preview synthesizes a short sample sentence and returns the WAV bytes.
func (s *Service) Preview(ctx context.Context, req Request) ([]byte, error) {
	if strings.TrimSpace(req.Text) == "" {
		req.Text = "Guten Abend. Dies ist eine Hörprobe für die Theaterprobe."
	}
	seg, err := s.piper.Synthesize(ctx, req)
	if err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp("", "preview-*.wav")
	if err != nil {
		return nil, err
	}
	path := tmp.Name()
	tmp.Close()
	defer os.Remove(path)

	if err := writeWAV(path, resample(seg, s.cfg.SampleRate), s.cfg.SampleRate); err != nil {
		return nil, err
	}
	return os.ReadFile(path)
}

// Validate checks that every speaker that will actually be spoken has a voice
// model assigned and that the model exists on disk. It returns a list of
// human readable problems (empty = ready to synthesize).
func (s *Service) Validate(projectID string, opts Options) ([]string, error) {
	proj, err := s.store.Get(projectID)
	if err != nil {
		return nil, err
	}
	blocks, err := s.store.Blocks(projectID)
	if err != nil {
		return nil, err
	}
	speakers, err := s.store.Speakers(projectID)
	if err != nil {
		return nil, err
	}

	installed, err := s.registry.List()
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, v := range installed {
		known[v.Name] = true
	}

	seen := map[string]bool{}
	var problems []string
	for _, b := range blocks {
		if strings.TrimSpace(b.Text) == "" {
			continue
		}
		key, skip := speakerKey(b, proj, opts)
		if skip || key == "" || seen[key] {
			continue
		}
		seen[key] = true

		label := key
		if key == project.DirectionKey {
			label = "Regieanweisungen"
		}
		cfg, ok := speakers[key]
		if !ok || strings.TrimSpace(cfg.Model) == "" {
			problems = append(problems, fmt.Sprintf("%s: keine Stimme zugewiesen", label))
			continue
		}
		if !known[cfg.Model] {
			problems = append(problems, fmt.Sprintf("%s: Modell %q liegt nicht in %s", label, cfg.Model, s.registry.Dir()))
		}
	}
	sort.Strings(problems)
	return problems, nil
}

// Start kicks off an asynchronous synthesis job and returns immediately.
func (s *Service) Start(projectID string, opts Options) (Job, error) {
	proj, err := s.store.Get(projectID)
	if err != nil {
		return Job{}, err
	}
	blocks, err := s.store.Blocks(projectID)
	if err != nil {
		return Job{}, err
	}
	speakers, err := s.store.Speakers(projectID)
	if err != nil {
		return Job{}, err
	}

	todo := make([]project.Block, 0, len(blocks))
	for _, b := range blocks {
		if strings.TrimSpace(b.Text) == "" {
			continue
		}
		if b.Type == project.TypeDirection && !opts.IncludeDirections {
			continue
		}
		todo = append(todo, b)
	}
	if len(todo) == 0 {
		return Job{}, errors.New("keine Blöcke zum Vorlesen vorhanden")
	}

	job := s.Jobs.create(projectID, len(todo))
	ctx, cancel := context.WithCancel(context.Background())
	s.Jobs.mu.Lock()
	s.Jobs.cancel[job.ID] = cancel
	s.Jobs.mu.Unlock()

	go func() {
		defer cancel()
		s.run(ctx, job.ID, proj, todo, speakers, opts)
	}()
	return *job, nil
}

func (s *Service) run(ctx context.Context, jobID string, proj project.Project,
	blocks []project.Block, speakers project.Speakers, opts Options) {

	s.Jobs.update(jobID, func(j *Job) {
		j.Status = StatusRunning
		j.Message = "Synthese läuft"
	})

	fail := func(err error) {
		now := time.Now().UTC()
		s.Jobs.update(jobID, func(j *Job) {
			j.Status = StatusError
			j.Error = err.Error()
			j.Message = "Fehler"
			j.EndedAt = &now
		})
	}

	rate := s.cfg.SampleRate
	all := make([]int, 0, rate*60)
	gap := silence(s.cfg.GapMillis, rate)

	for i, b := range blocks {
		select {
		case <-ctx.Done():
			fail(errors.New("Job abgebrochen"))
			return
		default:
		}

		key, skip := speakerKey(b, proj, opts)
		if skip {
			all = append(all, silence(s.cfg.SkippedRoleMillis, rate)...)
			s.progress(jobID, i+1, "Pause für eigene Rolle")
			continue
		}

		cfg, ok := speakers[key]
		if !ok || strings.TrimSpace(cfg.Model) == "" {
			fail(fmt.Errorf("Block %d: für %q ist keine Stimme konfiguriert", i+1, key))
			return
		}
		seg, err := s.piper.Synthesize(ctx, Request{
			Text:        b.Text,
			Model:       cfg.Model,
			SpeakerID:   cfg.SpeakerID,
			LengthScale: orDefault(cfg.LengthScale, 1.0),
			Volume:      orDefault(cfg.Volume, 1.0),
		})
		if err != nil {
			fail(fmt.Errorf("Block %d (%s): %w", i+1, key, err))
			return
		}
		all = append(all, resample(seg, rate)...)
		all = append(all, gap...)
		s.progress(jobID, i+1, fmt.Sprintf("%d/%d gesprochen", i+1, len(blocks)))
	}

	outDir := s.store.AudioDir(proj.ID)
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fail(err)
		return
	}
	wavPath := filepath.Join(outDir, jobID+".wav")
	if err := writeWAV(wavPath, all, rate); err != nil {
		fail(err)
		return
	}

	finalPath, format := wavPath, "wav"
	if mp3, err := s.toMP3(ctx, wavPath); err == nil && mp3 != "" {
		finalPath, format = mp3, "mp3"
		_ = os.Remove(wavPath)
	}

	now := time.Now().UTC()
	s.Jobs.update(jobID, func(j *Job) {
		j.Status = StatusDone
		j.Done = j.Total
		j.Message = "Fertig"
		j.Format = format
		j.filePath = finalPath
		j.EndedAt = &now
	})
}

func (s *Service) progress(jobID string, done int, msg string) {
	s.Jobs.update(jobID, func(j *Job) {
		j.Done = done
		j.Message = msg
	})
}

// toMP3 converts the WAV to MP3 if ffmpeg is available. Any failure is
// non-fatal: the WAV stays the deliverable.
func (s *Service) toMP3(ctx context.Context, wavPath string) (string, error) {
	if strings.TrimSpace(s.cfg.FFmpegBin) == "" {
		return "", nil
	}
	bin, err := exec.LookPath(s.cfg.FFmpegBin)
	if err != nil {
		return "", nil // ffmpeg is optional
	}
	mp3Path := strings.TrimSuffix(wavPath, ".wav") + ".mp3"
	cmd := exec.CommandContext(ctx, bin, "-y", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-q:a", "4", mp3Path)
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(mp3Path)
		return "", fmt.Errorf("ffmpeg: %w (%s)", err, tail(string(out)))
	}
	return mp3Path, nil
}

// speakerKey resolves which speakers.json entry a block uses and whether the
// block should be replaced by a pause (own role).
func speakerKey(b project.Block, proj project.Project, opts Options) (key string, skip bool) {
	if b.Type == project.TypeDirection {
		if !opts.IncludeDirections {
			return "", true
		}
		return project.DirectionKey, false
	}
	name := ""
	if b.Speaker != nil {
		name = strings.TrimSpace(*b.Speaker)
	}
	if name == "" {
		return project.DirectionKey, false
	}
	if opts.SkipMyRole && proj.MyRole != "" && strings.EqualFold(name, proj.MyRole) {
		return name, true
	}
	return name, false
}

func orDefault(v, def float64) float64 {
	if v <= 0 {
		return def
	}
	return v
}
