package exercisegen_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	"github.com/ajayrajen7/anyway/server/internal/exercisegen"
)

// fakeMessages substitutes for anthropic.MessageService in tests — the
// package under test only ever calls .New once per Generate, so a single
// canned response (or error) is all a fake needs to return.
type fakeMessages struct {
	resp *anthropic.Message
	err  error
}

func (f *fakeMessages) New(ctx context.Context, params anthropic.MessageNewParams, opts ...option.RequestOption) (*anthropic.Message, error) {
	return f.resp, f.err
}

func toolUseResponse(t *testing.T, input any) *anthropic.Message {
	t.Helper()
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal fixture input: %v", err)
	}
	block := anthropic.ContentBlockUnion{}
	if err := json.Unmarshal([]byte(`{"type":"tool_use","id":"toolu_1","name":"record_exercise","input":`+string(raw)+`}`), &block); err != nil {
		t.Fatalf("unmarshal fixture tool_use block: %v", err)
	}
	return &anthropic.Message{Content: []anthropic.ContentBlockUnion{block}}
}

func newTestClient(t *testing.T, resp *anthropic.Message, err error) *exercisegen.Client {
	t.Helper()
	return exercisegen.NewForTest(&fakeMessages{resp: resp, err: err})
}

func TestGenerateReturnsAValidatedExercise(t *testing.T) {
	resp := toolUseResponse(t, map[string]any{
		"equipment":    "dumbbell",
		"pressure":     "moderate",
		"impact":       "none",
		"unilateral":   false,
		"increment_kg": 2.5,
		"blocked":      false,
		"block_reason": "",
		"caution":      "",
		"muscles":      map[string]float64{"chest": 1.0, "triceps": 0.5},
	})
	c := newTestClient(t, resp, nil)

	e, err := c.Generate(context.Background(), "Incline dumbbell press", "")
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if e.Slug != "incline-dumbbell-press" {
		t.Errorf("expected slugified name, got %q", e.Slug)
	}
	if e.Source != "llm" {
		t.Errorf("expected source=llm, got %q", e.Source)
	}
	if e.Blocked {
		t.Errorf("expected not blocked")
	}
	if e.Muscles["chest"] != 1.0 {
		t.Errorf("expected chest weight 1.0, got %v", e.Muscles)
	}
}

func TestGenerateSetsBlockReasonWhenBlocked(t *testing.T) {
	resp := toolUseResponse(t, map[string]any{
		"equipment":    "barbell",
		"pressure":     "high",
		"impact":       "none",
		"unilateral":   false,
		"increment_kg": 2.5,
		"blocked":      true,
		"block_reason": "Braced hinge — high intra-abdominal pressure",
		"caution":      "",
		"muscles":      map[string]float64{"hamstrings": 1.0},
	})
	c := newTestClient(t, resp, nil)

	e, err := c.Generate(context.Background(), "Sumo deadlift", "")
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if !e.Blocked || e.BlockReason == nil || *e.BlockReason == "" {
		t.Fatalf("expected a populated block_reason, got %+v", e)
	}
}

func TestGenerateRejectsInvalidModelOutput(t *testing.T) {
	// Missing muscles + an out-of-vocabulary pressure — should be caught by
	// seed.ValidateExercise, not silently accepted.
	resp := toolUseResponse(t, map[string]any{
		"equipment":    "cable",
		"pressure":     "extreme",
		"impact":       "none",
		"unilateral":   false,
		"increment_kg": 2.5,
		"blocked":      false,
		"block_reason": "",
		"caution":      "",
		"muscles":      map[string]float64{},
	})
	c := newTestClient(t, resp, nil)

	if _, err := c.Generate(context.Background(), "Cable something", ""); err == nil {
		t.Fatal("expected an error for invalid model output")
	}
}

func TestGenerateRejectsBlankName(t *testing.T) {
	c := newTestClient(t, nil, nil)
	if _, err := c.Generate(context.Background(), "   ", ""); err == nil {
		t.Fatal("expected an error for a blank name")
	}
}
