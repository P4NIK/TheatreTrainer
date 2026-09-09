package main

// Erzeugt die Cache-Schluessel der Go-Fassung fuer einen festen Satz von
// Anfragen. Die TypeScript-Portierung muss dieselben liefern - sonst faellt
// beim Umstieg der gesamte vorhandene Zwischenspeicher aus.

import (
	"encoding/json"
	"os"
)

type row struct {
	Req  Request `json:"req"`
	Key  string  `json:"key"`
	Norm string  `json:"norm"`
}

func main() {
	texts := []string{
		"Guten Abend, Frau Nachbarin.",
		"  führende   und   mehrfache\tLeerzeichen\nsamt Zeilenumbruch  ",
		"",
		"   ",
		"Ein einzelnes Wort",
		"Umlaute: Käse, Öl, Übermut, Straße – und ein Gedankenstrich",
		"Zahlen 1918 und 29er",
		"Emoji 🎭 und ein Tabulator\tdazwischen",
	}
	models := []string{"de_DE-thorsten-medium", "de_DE-mls-medium", ""}
	scales := []float64{1, 0.9, 1.1, 1.25, 0.85, 2, 0.5, 0, -1, 1.0 / 3.0, 0.1 + 0.2,
		1e21, 2.5e22, 1e-7, 1.5e-7, 1e-9, 123456789.123456, 1e-320}
	sids := []int{0, 7, 235}

	var rows []row
	for _, t := range texts {
		for _, m := range models {
			for _, s := range scales {
				for _, sid := range sids {
					// Lautstaerke und Tonhoehe gehen bewusst nicht in den
					// Schluessel ein - mitgegeben, um genau das zu pruefen.
					req := Request{Text: t, Model: m, SpeakerID: sid, LengthScale: s,
						Volume: 0.7, Pitch: 1.2}
					rows = append(rows, row{req, Key(req), NormalizeText(t)})
				}
			}
		}
	}
	j, _ := json.MarshalIndent(rows, "", " ")
	os.WriteFile(os.Args[1], j, 0o644)
	println(len(rows), "Schluessel geschrieben")
}
