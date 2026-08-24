package project

import "time"

// Project is the metadata of one play. One project owns exactly one PDF.
type Project struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	PDFFile   string    `json:"pdfFile"`
	PageCount int       `json:"pageCount"`
	CreatedAt time.Time `json:"createdAt"`
	// MyRole is the speaker name whose lines can be replaced by a pause
	// during synthesis. Empty means "no role selected".
	MyRole string `json:"myRole"`
}

// Rect is a selection rectangle in page-relative coordinates (0..1), so it
// stays valid at any zoom level or rendering resolution.
type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// Block types.
const (
	TypeLine      = "line"      // spoken line of a character
	TypeDirection = "direction" // stage direction
)

// Block is a single marked area on a page together with its text.
type Block struct {
	ID   string `json:"id"`
	Page int    `json:"page"`
	Rect Rect   `json:"rect"`
	// Order determines the reading order across the whole play and is freely
	// re-orderable in the UI (multi-column layouts are not top-to-bottom).
	Order int    `json:"order"`
	Type  string `json:"type"`
	// Speaker is nil for stage directions.
	Speaker *string `json:"speaker"`
	Text    string  `json:"text"`
}

// DirectionKey is the pseudo speaker name used for stage directions in
// speakers.json.
const DirectionKey = "_direction"

// SpeakerConfig is the voice assignment for one speaker.
type SpeakerConfig struct {
	Model       string  `json:"model"`
	SpeakerID   int     `json:"speakerId"`
	LengthScale float64 `json:"lengthScale"`
	Volume      float64 `json:"volume"`
	// Pitch shifts the voice without changing the tempo. 1.0 = unchanged.
	// Lets one good voice model carry several distinguishable roles.
	Pitch float64 `json:"pitch"`
	Color string  `json:"color"`
}

// Speakers maps speaker name -> voice configuration.
type Speakers map[string]SpeakerConfig
