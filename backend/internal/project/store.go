// Package project implements CRUD and JSON persistence for projects, blocks
// and speaker configurations. One project = one directory below
// <data>/projects/<id>/.
package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// ErrNotFound is returned when a project does not exist.
var ErrNotFound = errors.New("project not found")

const (
	fileProject  = "project.json"
	fileBlocks   = "blocks.json"
	fileSpeakers = "speakers.json"
)

// Store persists projects as plain JSON files on disk. A single mutex is
// plenty for a single-user desktop app.
type Store struct {
	root string // <data>/projects
	mu   sync.RWMutex
}

// NewStore creates the projects directory if needed.
func NewStore(projectsDir string) (*Store, error) {
	if err := os.MkdirAll(projectsDir, 0o755); err != nil {
		return nil, err
	}
	return &Store{root: projectsDir}, nil
}

// Dir returns the on-disk directory of a project.
func (s *Store) Dir(id string) string { return filepath.Join(s.root, id) }

// List returns all projects, newest first.
func (s *Store) List() ([]Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	out := make([]Project, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p, err := s.readProject(e.Name())
		if err != nil {
			continue // ignore stray directories
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

// Get loads a single project.
func (s *Store) Get(id string) (Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readProject(id)
}

// Create writes a new project directory and stores the uploaded PDF.
func (s *Store) Create(name, pdfName string, pdf io.Reader) (Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := s.uniqueSlug(slugify(name))
	dir := filepath.Join(s.root, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Project{}, err
	}

	fileName := "source.pdf"
	if pdf != nil {
		f, err := os.Create(filepath.Join(dir, fileName))
		if err != nil {
			_ = os.RemoveAll(dir)
			return Project{}, err
		}
		if _, err := io.Copy(f, pdf); err != nil {
			f.Close()
			_ = os.RemoveAll(dir)
			return Project{}, err
		}
		if err := f.Close(); err != nil {
			_ = os.RemoveAll(dir)
			return Project{}, err
		}
	}
	_ = pdfName // the original name is not needed; the file is always source.pdf

	p := Project{
		ID:        id,
		Name:      strings.TrimSpace(name),
		PDFFile:   fileName,
		CreatedAt: time.Now().UTC(),
	}
	if err := writeJSON(filepath.Join(dir, fileProject), p); err != nil {
		_ = os.RemoveAll(dir)
		return Project{}, err
	}
	if err := writeJSON(filepath.Join(dir, fileBlocks), []Block{}); err != nil {
		return Project{}, err
	}
	if err := writeJSON(filepath.Join(dir, fileSpeakers), defaultSpeakers()); err != nil {
		return Project{}, err
	}
	return p, nil
}

// ProjectUpdate carries the mutable fields of a project. Nil fields are left
// untouched.
type ProjectUpdate struct {
	Name      *string `json:"name"`
	MyRole    *string `json:"myRole"`
	PageCount *int    `json:"pageCount"`
}

// Update patches project metadata.
func (s *Store) Update(id string, u ProjectUpdate) (Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	p, err := s.readProject(id)
	if err != nil {
		return Project{}, err
	}
	if u.Name != nil && strings.TrimSpace(*u.Name) != "" {
		p.Name = strings.TrimSpace(*u.Name)
	}
	if u.MyRole != nil {
		p.MyRole = *u.MyRole
	}
	if u.PageCount != nil {
		p.PageCount = *u.PageCount
	}
	if err := writeJSON(filepath.Join(s.root, id, fileProject), p); err != nil {
		return Project{}, err
	}
	return p, nil
}

// Delete removes a project including its PDF and generated audio.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Join(s.root, id)
	if _, err := os.Stat(filepath.Join(dir, fileProject)); err != nil {
		return ErrNotFound
	}
	return os.RemoveAll(dir)
}

// PDFPath returns the absolute path of the project's PDF.
func (s *Store) PDFPath(id string) (string, error) {
	p, err := s.Get(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.root, id, p.PDFFile), nil
}

// Blocks loads the block list of a project.
func (s *Store) Blocks(id string) ([]Block, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, err := s.readProject(id); err != nil {
		return nil, err
	}
	var blocks []Block
	if err := readJSON(filepath.Join(s.root, id, fileBlocks), &blocks); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Block{}, nil
		}
		return nil, err
	}
	if blocks == nil {
		blocks = []Block{}
	}
	sort.SliceStable(blocks, func(i, j int) bool { return blocks[i].Order < blocks[j].Order })
	return blocks, nil
}

// SaveBlocks replaces the complete block list (the frontend owns the state).
func (s *Store) SaveBlocks(id string, blocks []Block) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.readProject(id); err != nil {
		return err
	}
	if blocks == nil {
		blocks = []Block{}
	}
	for i := range blocks {
		if blocks[i].Type != TypeDirection {
			blocks[i].Type = TypeLine
		}
		if blocks[i].Type == TypeDirection {
			blocks[i].Speaker = nil
		}
	}
	sort.SliceStable(blocks, func(i, j int) bool { return blocks[i].Order < blocks[j].Order })
	return writeJSON(filepath.Join(s.root, id, fileBlocks), blocks)
}

// Speakers loads the speaker configuration.
func (s *Store) Speakers(id string) (Speakers, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if _, err := s.readProject(id); err != nil {
		return nil, err
	}
	sp := Speakers{}
	if err := readJSON(filepath.Join(s.root, id, fileSpeakers), &sp); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return defaultSpeakers(), nil
		}
		return nil, err
	}
	return sp, nil
}

// SaveSpeakers replaces the speaker configuration.
func (s *Store) SaveSpeakers(id string, sp Speakers) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.readProject(id); err != nil {
		return err
	}
	if sp == nil {
		sp = Speakers{}
	}
	return writeJSON(filepath.Join(s.root, id, fileSpeakers), sp)
}

// AudioDir is where generated audio files of a project are stored.
func (s *Store) AudioDir(id string) string { return filepath.Join(s.root, id, "audio") }

func (s *Store) readProject(id string) (Project, error) {
	if !validID(id) {
		return Project{}, ErrNotFound
	}
	var p Project
	if err := readJSON(filepath.Join(s.root, id, fileProject), &p); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Project{}, ErrNotFound
		}
		return Project{}, err
	}
	return p, nil
}

func (s *Store) uniqueSlug(base string) string {
	if base == "" {
		base = "projekt"
	}
	id := base
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(s.root, id)); os.IsNotExist(err) {
			return id
		}
		id = fmt.Sprintf("%s-%d", base, i)
	}
}

func defaultSpeakers() Speakers {
	return Speakers{
		DirectionKey: {Model: "", SpeakerID: 0, LengthScale: 1.15, Volume: 0.7, Color: "#868e96"},
	}
}

var (
	slugStrip   = regexp.MustCompile(`[^a-z0-9]+`)
	idPattern   = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
	umlautPairs = strings.NewReplacer(
		"ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss",
		"Ä", "ae", "Ö", "oe", "Ü", "ue",
	)
)

func slugify(s string) string {
	s = umlautPairs.Replace(strings.ToLower(strings.TrimSpace(s)))
	s = slugStrip.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// validID guards against path traversal in URL parameters.
func validID(id string) bool {
	if id == "" || id == "." || id == ".." || strings.Contains(id, "..") {
		return false
	}
	return idPattern.MatchString(id)
}

func writeJSON(path string, v any) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
