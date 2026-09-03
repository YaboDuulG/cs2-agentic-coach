package parser

import (
	"os"
	"testing"
)

// Regression harness for real demos: point LOCAL_DEMO at a .dem file to run
// the full parse against it. Skipped otherwise, so CI is unaffected. This
// exists because demo-format breaks ("unable to find existing entity N")
// only reproduce on demos recorded after a CS2 update — unit fixtures can't
// catch them.
func TestParseLocalDemo(t *testing.T) {
	path := os.Getenv("LOCAL_DEMO")
	if path == "" {
		t.Skip("LOCAL_DEMO not set — skipping real-demo regression parse")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()

	res, err := parseDemoStream("local-test", f)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	t.Logf(
		"map=%s tickrate=%d rounds=%d kills=%d grenades=%d",
		res.MapName, res.Tickrate, len(res.Rounds), len(res.Kills), len(res.Grenades),
	)
	if len(res.Rounds) == 0 {
		t.Fatal("no live rounds parsed from a real match demo")
	}
}
