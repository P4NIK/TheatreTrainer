package synth

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// renderVersion is part of every cache key. Bump it whenever a change to the
// Piper invocation would produce different audio for unchanged settings – old
// entries then simply stop matching instead of being served stale.
const renderVersion = 1

// Cache stores the raw Piper output of single blocks as WAV files, so a change
// to one line does not cost a re-run of the whole play.
//
// The key covers exactly what Piper sees: the text and the settings that are
// passed on the command line. Volume and pitch are applied afterwards and are
// deliberately *not* part of the key – moving those sliders stays instant.
type Cache struct {
	dir string
	mu  sync.Mutex
}

// NewCache prepares the cache directory of one project.
func NewCache(dir string) *Cache { return &Cache{dir: dir} }

// Key is the identity of a rendered block.
func Key(req Request) string {
	h := sha256.New()
	fmt.Fprintf(h, "v%d\n%s\n%d\n%s\n%s\n",
		renderVersion,
		req.Model,
		req.SpeakerID,
		formatFloat(orOne(req.LengthScale)),
		NormalizeText(req.Text),
	)
	return hex.EncodeToString(h.Sum(nil))[:32]
}

func orOne(v float64) float64 {
	if v <= 0 {
		return 1
	}
	return v
}

func (c *Cache) path(key string) string { return filepath.Join(c.dir, key+".wav") }

// Get returns the stored audio for a key.
func (c *Cache) Get(key string) (segment, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	seg, err := readWAVMono(c.path(key))
	if err != nil {
		return segment{}, false
	}
	return seg, true
}

// Put stores audio under a key. A failure here is not fatal: the caller can
// always synthesize again, so the error is only worth logging.
func (c *Cache) Put(key string, seg segment) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := os.MkdirAll(c.dir, 0o755); err != nil {
		return err
	}
	tmp := c.path(key) + ".tmp"
	if err := writeWAV(tmp, seg.samples, seg.sampleRate); err != nil {
		return err
	}
	return os.Rename(tmp, c.path(key))
}

// Stats reports how much space the cache uses.
func (c *Cache) Stats() (files int, bytes int64) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return 0, 0
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".wav") {
			continue
		}
		if info, err := e.Info(); err == nil {
			files++
			bytes += info.Size()
		}
	}
	return files, bytes
}

// Clear removes everything.
func (c *Cache) Clear() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return os.RemoveAll(c.dir)
}

// KeepOnly deletes entries that no current block refers to, so editing a play
// does not let the cache grow without bound. Returns how many files went.
func (c *Cache) KeepOnly(keys map[string]bool) int {
	c.mu.Lock()
	defer c.mu.Unlock()

	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return 0
	}
	removed := 0
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".wav") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		if keys[strings.TrimSuffix(name, ".wav")] {
			continue
		}
		if os.Remove(filepath.Join(c.dir, name)) == nil {
			removed++
		}
	}
	return removed
}
