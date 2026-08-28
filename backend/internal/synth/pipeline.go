package synth

import (
	"context"
	"errors"
	"fmt"
	"log"
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

// Cache returns the block cache of one project.
func (s *Service) Cache(projectID string) *Cache {
	return NewCache(s.store.CacheDir(projectID))
}

// renderBlock returns the audio of one block, from the cache when possible.
// Only the raw Piper output is cached; volume and pitch are applied on top, so
// changing those sliders costs nothing.
func (s *Service) renderBlock(ctx context.Context, cache *Cache, req Request) (seg segment, cached bool, err error) {
	if NormalizeText(req.Text) == "" {
		return segment{}, true, nil
	}
	key := Key(req)
	if raw, ok := cache.Get(key); ok {
		return postProcess(raw, req), true, nil
	}
	raw, err := s.piper.Render(ctx, req)
	if err != nil {
		return segment{}, false, err
	}
	if err := cache.Put(key, raw); err != nil {
		log.Printf("Zwischenspeicher: %v", err)
	}
	return postProcess(raw, req), false, nil
}

// ReferencedKeys is the set of cache entries the current blocks still need.
func (s *Service) ReferencedKeys(projectID string) (map[string]bool, error) {
	blocks, err := s.store.Blocks(projectID)
	if err != nil {
		return nil, err
	}
	speakers, err := s.store.Speakers(projectID)
	if err != nil {
		return nil, err
	}
	proj, err := s.store.Get(projectID)
	if err != nil {
		return nil, err
	}

	keys := map[string]bool{}
	for _, b := range blocks {
		// Both switches are deliberately ignored here: a block whose audio is
		// currently not used keeps its entry, so flipping a switch back is
		// instant instead of costing another full run.
		req, ok := requestFor(b, proj, speakers, Options{IncludeDirections: true})
		if !ok {
			continue
		}
		keys[Key(req)] = true
	}
	return keys, nil
}

// requestFor builds the synthesis request of a block, or reports that the
// block has no usable voice configuration.
func requestFor(b project.Block, proj project.Project, speakers project.Speakers, opts Options) (Request, bool) {
	if strings.TrimSpace(b.Text) == "" {
		return Request{}, false
	}
	key, _ := speakerKey(b, proj, opts)
	if key == "" {
		return Request{}, false
	}
	cfg, ok := speakers[key]
	if !ok || strings.TrimSpace(cfg.Model) == "" {
		return Request{}, false
	}
	return Request{
		Text:        b.Text,
		Model:       cfg.Model,
		SpeakerID:   cfg.SpeakerID,
		LengthScale: orDefault(cfg.LengthScale, 1.0),
		Volume:      orDefault(cfg.Volume, 1.0),
		Pitch:       orDefault(cfg.Pitch, 1.0),
	}, true
}

// RenderSingleBlock produces the audio of one block for playback in the
// editor, at the project's output sample rate.
func (s *Service) RenderSingleBlock(ctx context.Context, projectID, blockID string) ([]byte, error) {
	blocks, err := s.store.Blocks(projectID)
	if err != nil {
		return nil, err
	}
	proj, err := s.store.Get(projectID)
	if err != nil {
		return nil, err
	}
	speakers, err := s.store.Speakers(projectID)
	if err != nil {
		return nil, err
	}

	for _, b := range blocks {
		if b.ID != blockID {
			continue
		}
		req, ok := requestFor(b, proj, speakers, Options{IncludeDirections: true})
		if !ok {
			return nil, fmt.Errorf("für diesen Block ist keine Stimme konfiguriert")
		}
		seg, _, err := s.renderBlock(ctx, s.Cache(projectID), req)
		if err != nil {
			return nil, err
		}
		return encodeWAV(resample(seg, s.cfg.SampleRate), s.cfg.SampleRate)
	}
	return nil, fmt.Errorf("Block %q gehört nicht zu diesem Projekt", blockID)
}

// Preview synthesizes a short sample sentence and returns the WAV bytes.
func (s *Service) Preview(ctx context.Context, req Request) ([]byte, error) {
	if strings.TrimSpace(req.Text) == "" {
		req.Text = "Guten Abend. Dies ist eine Hörprobe für die Theaterprobe."
	}
	// Previews bypass the cache: their text is ad hoc and would only fill it
	// with entries no block refers to.
	raw, err := s.piper.Render(ctx, req)
	if err != nil {
		return nil, err
	}
	seg := postProcess(raw, req)
	return encodeWAV(resample(seg, s.cfg.SampleRate), s.cfg.SampleRate)
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
	cache := s.Cache(proj.ID)
	rendered, fromCache, skippedRole, fixedPauses := 0, 0, 0, 0

	for i, b := range blocks {
		select {
		case <-ctx.Done():
			fail(errors.New("Job abgebrochen"))
			return
		default:
		}

		key, skip := speakerKey(b, proj, opts)
		if key == "" {
			continue
		}
		cfg, ok := speakers[key]
		hasVoice := ok && strings.TrimSpace(cfg.Model) != ""

		if !hasVoice {
			// A skipped role does not strictly need a voice. Without one the
			// length of the line is unknown, so the fixed pause is used and
			// the job says so at the end.
			if skip {
				all = append(all, silence(s.cfg.SkippedRoleMillis, rate)...)
				all = append(all, gap...)
				skippedRole++
				fixedPauses++
				s.progress(jobID, i+1, rendered, fromCache, "Pause für die eigene Rolle")
				continue
			}
			label := key
			if label == project.DirectionKey {
				label = "Regieanweisungen"
			}
			fail(fmt.Errorf("Block %d: für %q ist keine Stimme konfiguriert", i+1, label))
			return
		}

		req := Request{
			Text:        b.Text,
			Model:       cfg.Model,
			SpeakerID:   cfg.SpeakerID,
			LengthScale: orDefault(cfg.LengthScale, 1.0),
			Volume:      orDefault(cfg.Volume, 1.0),
			Pitch:       orDefault(cfg.Pitch, 1.0),
		}

		// Your own lines are synthesized as well, even when they are skipped:
		// only then is it known how long the gap has to be. The pause matches
		// the length of the line, so the cue comes at the right moment – and
		// the audio is in the cache, which makes switching the option back
		// instant.
		seg, hit, err := s.renderBlock(ctx, cache, req)
		if err != nil {
			fail(fmt.Errorf("Block %d (%s): %w", i+1, key, err))
			return
		}
		if hit {
			fromCache++
		} else {
			rendered++
		}

		samples := resample(seg, rate)
		if skip {
			samples = make([]int, len(samples))
			skippedRole++
		}
		all = append(all, samples...)
		all = append(all, gap...)

		s.progress(jobID, i+1, rendered, fromCache,
			fmt.Sprintf("%d/%d – %d neu, %d aus dem Zwischenspeicher", i+1, len(blocks), rendered, fromCache))
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

	// Entries that no block refers to any more would otherwise pile up.
	if keys, err := s.ReferencedKeys(proj.ID); err == nil {
		if n := cache.KeepOnly(keys); n > 0 {
			log.Printf("Zwischenspeicher: %d verwaiste Dateien entfernt", n)
		}
	}

	now := time.Now().UTC()
	s.Jobs.update(jobID, func(j *Job) {
		j.Status = StatusDone
		j.Done = j.Total
		j.Rendered = rendered
		j.Cached = fromCache
		j.SkippedRole = skippedRole
		j.Message = doneMessage(rendered, fromCache, skippedRole, fixedPauses)
		j.Format = format
		j.filePath = finalPath
		j.EndedAt = &now
	})
}

func (s *Service) progress(jobID string, done, rendered, cached int, msg string) {
	s.Jobs.update(jobID, func(j *Job) {
		j.Done = done
		j.Rendered = rendered
		j.Cached = cached
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
	// Encoding at 44.1 kHz keeps LAME on MPEG-1, whose psychoacoustic model is
	// markedly better than the MPEG-2 half-rate mode it uses for 22.05 kHz
	// input – there the default quality setting lands near 50 kbit/s.
	cmd := exec.CommandContext(ctx, bin, "-y", "-loglevel", "error",
		"-i", wavPath, "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", mp3Path)
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

// doneMessage summarises a finished run in one line.
func doneMessage(rendered, cached, skippedRole, fixedPauses int) string {
	msg := fmt.Sprintf("Fertig – %d neu erzeugt, %d aus dem Zwischenspeicher", rendered, cached)
	if skippedRole > 0 {
		msg += fmt.Sprintf(", %d Repliken als Pause", skippedRole)
	}
	if fixedPauses > 0 {
		msg += fmt.Sprintf(" (davon %d mit fester Länge, weil der Rolle keine Stimme zugewiesen ist)", fixedPauses)
	}
	return msg
}
