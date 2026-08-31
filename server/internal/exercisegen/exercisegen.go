// Package exercisegen drafts new exercise-library entries — muscle
// weights, pressure/impact, increment_kg — for exercises the hand-
// transcribed library (docs/prd.md §A5) doesn't cover, by calling a cheap
// LLM (Claude Haiku 4.5 — the owner's own "any cheap one would do").
//
// This is the one deliberate online-only step in an otherwise
// offline-first app (docs/architecture.md §B2's amendment, memory.md's
// "real-time exercise creation" decision): it runs from AddExercise's
// search sheet, before an exercise exists to search/add, never inside
// actual set-logging — everything downstream of a generated exercise
// (finding it, logging sets against it, syncing) is exactly as offline as
// any seeded exercise.
//
// LLM output is real but meaningfully lower-confidence than the
// transcribed programme data CLAUDE.md rule 8 calls out as carrying real
// injury-safety weight. Every record this package produces is written
// back with Source: "llm" (never "programme"), so the client can flag it
// distinctly instead of blending it in at equal trust.
package exercisegen

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	"github.com/ajayrajen7/anyway/server/internal/seed"
)

// model is deliberately the cheapest current Claude model.
const model = anthropic.ModelClaudeHaiku4_5_20251001

// messageCreator is the one method this package needs from
// anthropic.MessageService, narrowed to a local interface so tests can
// substitute a fake instead of making a real network call.
type messageCreator interface {
	New(ctx context.Context, params anthropic.MessageNewParams, opts ...option.RequestOption) (*anthropic.Message, error)
}

// Client generates new exercise records via the Anthropic API.
type Client struct {
	messages messageCreator
}

// New builds a Client using the Anthropic SDK's normal credential
// resolution (ANTHROPIC_API_KEY, among others — see the SDK's own docs).
// It does not itself fail if no credential is configured; that surfaces as
// a clear error on the first Generate call instead, so an unconfigured key
// costs this one feature, not server startup — same "degrade this one
// thing, not the app" shape as backup.OffBoxCopy being nil until wired up.
func New() *Client {
	c := anthropic.NewClient()
	return &Client{messages: &c.Messages}
}

// NewForTest builds a Client around a fake messageCreator so tests can
// substitute canned responses instead of making a real network call. Only
// exported for exercisegen_test.go (an external test package, so it needs
// a real entry point rather than reaching into the unexported field) —
// not meant for use outside this package's own tests.
func NewForTest(messages messageCreator) *Client {
	return &Client{messages: messages}
}

// systemPrompt encodes the same injury constraints and muscle-weighting
// convention docs/prd.md §A5.2/§A5.3 already define for the hand-authored
// library, so an LLM-drafted entry is graded by the same rules a
// hand-transcribed one would be — not a looser, parallel standard.
const systemPrompt = `You draft entries for a strength-training exercise library used by one injury-constrained person. Two things aggravate their injuries and must be respected:
- intra-abdominal pressure (braced hinges, heavy carries, spinal flexion under load, standing braced overhead pressing) — their primary aggravator
- impact on the right knee (meniscal) and both Achilles tendons

If the requested exercise clearly matches one of those patterns (a braced hinge like a deadlift/RDL, a loaded back squat, a standing barbell overhead press, a kettlebell swing, a heavy carry, a hanging leg raise/ab-wheel/sit-up/hollow-hold, a box jump, running/skipping/plyometrics), set blocked=true and write a short block_reason in the same terse style as: "Braced hinge — high intra-abdominal pressure" or "Impact — knee and Achilles". Otherwise set blocked=false. If it is not blocked but still worth a heads-up (moderate axial loading, a technical setup, a common minor aggravator), fill caution with one short sentence; leave it "" otherwise.

Muscle weights use exactly this vocabulary and convention. Use only these muscle names: quads, hamstrings, glutes, adductors, calves, tibialis, foot, erectors, chest, lats, upper_back, delts_front, delts_side, delts_rear, biceps, triceps, core.
- 1.0 = primary mover (the set fully counts toward this muscle's weekly total)
- 0.5 = strong secondary — meaningful stimulus
- 0.3 = meaningful but not stimulus-driving
Map 1-4 muscles per exercise, using only those three weight values.

pressure is low/moderate/high (intra-abdominal pressure demand). impact is none/low/high (knee/Achilles impact). unilateral is true only for exercises worked one limb at a time. increment_kg is the smallest realistic load jump for progressing this exercise: 5 for machines, 1 for bands or bodyweight-with-added-load, 2.5 for most free weights, 0 if load is not really applicable (pure bodyweight).

Call record_exercise exactly once with your answer.`

var recordExerciseTool = anthropic.ToolUnionParam{
	OfTool: &anthropic.ToolParam{
		Name:        "record_exercise",
		Description: anthropic.String("Record one drafted exercise-library entry."),
		InputSchema: anthropic.ToolInputSchemaParam{
			Properties: map[string]any{
				"equipment":  map[string]any{"type": "string", "description": "e.g. dumbbell, barbell, machine, cable, band, bodyweight"},
				"pressure":   map[string]any{"type": "string", "enum": []string{"low", "moderate", "high"}},
				"impact":     map[string]any{"type": "string", "enum": []string{"none", "low", "high"}},
				"unilateral": map[string]any{"type": "boolean"},
				"increment_kg": map[string]any{
					"type":        "number",
					"description": "Smallest realistic load jump for progressing this exercise (kg).",
				},
				"blocked":      map[string]any{"type": "boolean"},
				"block_reason": map[string]any{"type": "string", "description": `Required, non-empty, if blocked is true. "" otherwise.`},
				"caution":      map[string]any{"type": "string", "description": `One short sentence, or "".`},
				"muscles": map[string]any{
					"type":                 "object",
					"description":          "Muscle name -> weight (1.0, 0.5, or 0.3 only). 1-4 entries.",
					"additionalProperties": map[string]any{"type": "number"},
				},
			},
			Required: []string{"equipment", "pressure", "impact", "unilateral", "increment_kg", "blocked", "block_reason", "caution", "muscles"},
		},
	},
}

type generated struct {
	Equipment   string             `json:"equipment"`
	Pressure    string             `json:"pressure"`
	Impact      string             `json:"impact"`
	Unilateral  bool               `json:"unilateral"`
	IncrementKg float64            `json:"increment_kg"`
	Blocked     bool               `json:"blocked"`
	BlockReason string             `json:"block_reason"`
	Caution     string             `json:"caution"`
	Muscles     map[string]float64 `json:"muscles"`
}

// Generate drafts one new Exercise for the given name (plus optional
// freeform notes — equipment, how it's performed, anything the picker
// wants to hand over), and validates it through seed.ValidateExercise —
// the exact same rules a hand-authored seed-file entry has to pass —
// before returning it. The returned Exercise has no ID/slug assigned by
// the database yet (seed.InsertOne does that) and Source is always "llm".
func (c *Client) Generate(ctx context.Context, name, notes string) (seed.Exercise, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return seed.Exercise{}, fmt.Errorf("exercise name is required")
	}

	userText := "Exercise name: " + name
	if n := strings.TrimSpace(notes); n != "" {
		userText += "\nNotes from the person adding it: " + n
	}

	resp, err := c.messages.New(ctx, anthropic.MessageNewParams{
		Model:      model,
		MaxTokens:  1024,
		System:     []anthropic.TextBlockParam{{Text: systemPrompt}},
		Messages:   []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(userText))},
		Tools:      []anthropic.ToolUnionParam{recordExerciseTool},
		ToolChoice: anthropic.ToolChoiceParamOfTool("record_exercise"),
	})
	if err != nil {
		return seed.Exercise{}, fmt.Errorf("generate exercise: %w", err)
	}

	var g generated
	found := false
	for _, block := range resp.Content {
		if tu, ok := block.AsAny().(anthropic.ToolUseBlock); ok && tu.Name == "record_exercise" {
			if err := json.Unmarshal(tu.Input, &g); err != nil {
				return seed.Exercise{}, fmt.Errorf("parse model output: %w", err)
			}
			found = true
			break
		}
	}
	if !found {
		return seed.Exercise{}, fmt.Errorf("model did not return a record_exercise call")
	}

	e := seed.Exercise{
		Slug:        slugify(name),
		Name:        name,
		Equipment:   g.Equipment,
		Pressure:    g.Pressure,
		Impact:      g.Impact,
		Unilateral:  g.Unilateral,
		IncrementKg: g.IncrementKg,
		Blocked:     g.Blocked,
		Muscles:     g.Muscles,
		Source:      "llm",
	}
	if g.BlockReason != "" {
		e.BlockReason = &g.BlockReason
	}
	if g.Caution != "" {
		e.Caution = &g.Caution
	}

	// Validate through the exact same rules a hand-authored seed-file entry
	// has to pass — never trust the model's JSON blindly, even though it
	// was schema-forced.
	if err := seed.ValidateExercise(e); err != nil {
		return seed.Exercise{}, fmt.Errorf("model produced an invalid exercise: %w", err)
	}
	return e, nil
}

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	s := slugPattern.ReplaceAllString(strings.ToLower(name), "-")
	return strings.Trim(s, "-")
}
