package synth

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestUTF8EnvOverridesStaleSettings(t *testing.T) {
	t.Setenv("PYTHONIOENCODING", "cp1252")
	t.Setenv("PYTHONUTF8", "0")

	env := utf8Env()
	var io, mode int
	for _, kv := range env {
		switch {
		case strings.HasPrefix(kv, "PYTHONIOENCODING="):
			io++
			if kv != "PYTHONIOENCODING=utf-8" {
				t.Errorf("PYTHONIOENCODING = %q, erwartet utf-8", kv)
			}
		case strings.HasPrefix(kv, "PYTHONUTF8="):
			mode++
			if kv != "PYTHONUTF8=1" {
				t.Errorf("PYTHONUTF8 = %q, erwartet 1", kv)
			}
		}
	}
	if io != 1 || mode != 1 {
		t.Fatalf("jede Variable muss genau einmal gesetzt sein, gefunden io=%d mode=%d", io, mode)
	}
}

// TestTextSurvivesNonUTF8Environment is the regression test for the mangled
// umlauts. Piper's Python build decodes stdin with the system's encoding, so
// on a German Windows (cp1252) "Hörprobe" arrives as "HÃ¶rprobe" – and since
// espeak pronounces stray symbols by name, the voice says "A Tilde" and
// "Absatz" instead of the umlaut. Setting PYTHONIOENCODING=cp1252 reproduces
// exactly that decoding on any machine.
func TestTextSurvivesNonUTF8Environment(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 nicht installiert")
	}
	const text = "Guten Abend. Dies ist eine Hörprobe für die Straße."
	const echo = "import sys; sys.stdout.buffer.write(sys.stdin.read().encode('utf-8'))"

	// Stand-in for a Windows machine with a Western European code page.
	t.Setenv("PYTHONIOENCODING", "cp1252")
	t.Setenv("PYTHONUTF8", "0")

	run := func(env []string) string {
		cmd := exec.Command(python, "-c", echo)
		cmd.Env = env
		cmd.Stdin = strings.NewReader(text + "\n")
		out, err := cmd.Output()
		if err != nil {
			return "<Fehler: " + err.Error() + ">"
		}
		return strings.TrimSpace(string(out))
	}

	// Sanity check: the simulated environment really does mangle the text.
	if mangled := run(os.Environ()); mangled == text {
		t.Fatalf("Simulation greift nicht – Text kam unverändert an: %q", mangled)
	} else if !strings.Contains(mangled, "Ã") {
		t.Logf("Hinweis: erwartete Verstümmelung sieht anders aus: %q", mangled)
	}

	// With the environment the app builds, the text must arrive intact.
	if got := run(utf8Env()); got != text {
		t.Fatalf("Text kam verstümmelt an:\n  gesendet:  %q\n  empfangen: %q", text, got)
	}
}
