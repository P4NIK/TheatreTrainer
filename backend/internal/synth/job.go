// Package synth drives the Piper CLI and concatenates the resulting audio
// into one rehearsal file. Jobs run asynchronously in a goroutine; an
// in-memory map is enough for the single-user setup this app targets.
package synth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// Job states.
const (
	StatusPending = "pending"
	StatusRunning = "running"
	StatusDone    = "done"
	StatusError   = "error"
)

// Job is the public status of one synthesis run.
type Job struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Status    string `json:"status"`
	Total     int    `json:"total"`
	Done      int    `json:"done"`
	// Rendered counts blocks that had to go through Piper, Cached those that
	// came from the block cache.
	Rendered int `json:"rendered"`
	Cached   int `json:"cached"`
	// SkippedRole counts own-role lines that were replaced by a pause of the
	// same length.
	SkippedRole int        `json:"skippedRole"`
	Message     string     `json:"message"`
	Error       string     `json:"error,omitempty"`
	Format      string     `json:"format,omitempty"` // "wav" or "mp3"
	StartedAt   time.Time  `json:"startedAt"`
	EndedAt     *time.Time `json:"endedAt,omitempty"`

	filePath string
}

// FilePath is the absolute path of the finished audio file.
func (j Job) FilePath() string { return j.filePath }

// Options control what gets synthesized.
type Options struct {
	SkipMyRole        bool `json:"skipMyRole"`
	IncludeDirections bool `json:"includeDirections"`
}

// Jobs is a thread-safe registry of running and finished jobs.
type Jobs struct {
	mu     sync.RWMutex
	jobs   map[string]*Job
	cancel map[string]context.CancelFunc
}

// NewJobs creates an empty registry.
func NewJobs() *Jobs {
	return &Jobs{jobs: make(map[string]*Job), cancel: make(map[string]context.CancelFunc)}
}

func (r *Jobs) create(projectID string, total int) *Job {
	r.mu.Lock()
	defer r.mu.Unlock()
	j := &Job{
		ID:        newID(),
		ProjectID: projectID,
		Status:    StatusPending,
		Total:     total,
		StartedAt: time.Now().UTC(),
	}
	r.jobs[j.ID] = j
	return j
}

// Get returns a copy of the job status.
func (r *Jobs) Get(id string) (Job, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	j, ok := r.jobs[id]
	if !ok {
		return Job{}, false
	}
	return *j, true
}

// Cancel stops a running job if it exists.
func (r *Jobs) Cancel(id string) bool {
	r.mu.Lock()
	cancel, ok := r.cancel[id]
	r.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

func (r *Jobs) update(id string, fn func(*Job)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if j, ok := r.jobs[id]; ok {
		fn(j)
	}
}

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return time.Now().UTC().Format("20060102150405.000000")
	}
	return hex.EncodeToString(b)
}
