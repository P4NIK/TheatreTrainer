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
	// Progress is where the last rehearsal run stopped. nil means the play has
	// not been rehearsed yet, which is what the UI offers "start" for instead
	// of "carry on".
	Progress *Progress `json:"progress,omitempty"`
	// Premiere is the opening night as "2006-01-02", or "" when unknown. The
	// flashcards treat it as a ceiling: an interval that would jump clean over
	// the premiere helps nobody.
	Premiere string `json:"premiere"`
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

// RunSelection is the setup of a rehearsal run: which part of the play it
// covers. It is stored with the progress so that carrying on restores the same
// run instead of a differently-cut one, in which a remembered position would
// mean little.
type RunSelection struct {
	// Mode is one of "all", "pages", "role" or "blocks".
	Mode     string   `json:"mode"`
	FromPage int      `json:"fromPage"`
	ToPage   int      `json:"toPage"`
	Lead     int      `json:"lead"`
	Trail    int      `json:"trail"`
	MergeGap int      `json:"mergeGap"`
	BlockIDs []string `json:"blockIds"`
	Announce bool     `json:"announce"`
}

// Progress remembers where a rehearsal run stopped.
//
// The anchor is the block, not the step number: blocks get edited, re-ordered
// and re-cut all the time, and a bare index would quietly slide to a different
// line. Order and Page are kept alongside so a block that has since dropped out
// of the selection can still be resolved to the nearest position.
type Progress struct {
	BlockID string `json:"blockId"`
	Page    int    `json:"page"`
	Order   int    `json:"order"`
	// Role is the part that was being rehearsed, which is not necessarily the
	// project's own role.
	Role string `json:"role"`
	// Index and Total describe the run this position came from and exist for
	// the summary line in the UI ("step 42 of 120"). Nothing is resolved from
	// them.
	Index int `json:"index"`
	Total int `json:"total"`
	// Selection is the run this position belongs to.
	Selection *RunSelection `json:"selection,omitempty"`
	// Done marks a run that reached the end, so the UI offers starting over
	// rather than carrying on one step before the finish.
	Done      bool      `json:"done"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// DateLayout is how a day is written where only the day matters – the
// premiere and a card's due date.
const DateLayout = "2006-01-02"

// Gradings of a flashcard, as the person speaking judges it. The recogniser
// only suggests one: Whisper mishears often enough that letting it decide
// would send the wrong lines to the back of the deck.
const (
	GradeAgain = "again" // daneben – back to the first box
	GradeHard  = "hard"  // wackelig – stays where it is
	GradeGood  = "good"  // saß – one box further
)

// Card is the learning state of one line.
type Card struct {
	// Box is the Leitner box, 1-based; a higher one means longer between
	// repeats.
	Box int `json:"box"`
	// Due is the day the line is wanted again, as "2006-01-02". Days rather
	// than timestamps: whether something is due today should not depend on
	// the hour one happens to rehearse at.
	Due string `json:"due"`
	// Reviews counts every grading, Lapses only the ones that fell back, and
	// Streak the run of "good"s – together they make the deck readable
	// without replaying its history.
	Reviews   int    `json:"reviews"`
	Lapses    int    `json:"lapses"`
	Streak    int    `json:"streak"`
	LastGrade string `json:"lastGrade"`
	// LastReviewed is a full timestamp, unlike Due: it is shown as "3 days
	// ago", never compared against a day boundary.
	LastReviewed time.Time `json:"lastReviewed"`
}

// Cards maps block ID -> learning state.
//
// Only lines that have actually been graded appear here. The deck itself is
// derived from the blocks of the rehearsed role, so adding, splitting or
// deleting lines needs no bookkeeping in this file; what is left over is
// ignored on reading.
type Cards map[string]Card
