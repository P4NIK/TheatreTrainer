// Command server starts the Theater-Vorleser backend.
//
//	go run ./cmd/server
//
// All paths are resolved relative to the repository checkout and can be
// overridden with environment variables (see internal/config).
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/bloodmage/theater-tts/backend/internal/config"
	"github.com/bloodmage/theater-tts/backend/internal/httpapi"
	"github.com/bloodmage/theater-tts/backend/internal/project"
	"github.com/bloodmage/theater-tts/backend/internal/synth"
	"github.com/bloodmage/theater-tts/backend/internal/voices"
)

func main() {
	log.SetFlags(log.Ltime)

	cfg := config.Load()

	store, err := project.NewStore(cfg.ProjectsDir())
	if err != nil {
		log.Fatalf("Datenverzeichnis %s konnte nicht angelegt werden: %v", cfg.ProjectsDir(), err)
	}
	registry := voices.New(cfg.VoicesDir)
	service := synth.NewService(cfg, store, registry)

	log.Printf("Daten:   %s", cfg.DataDir)
	log.Printf("Stimmen: %s", cfg.VoicesDir)
	if info := service.PiperInfo(); info.Available {
		log.Printf("Piper:   %s", info.Command)
	} else {
		log.Printf("Piper:   NICHT gefunden – Synthese ist deaktiviert, siehe README")
		log.Printf("         versucht: %s", strings.Join(info.Tried, ", "))
		if info.Detail != "" {
			log.Printf("         %s", info.Detail)
		}
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.New(cfg, store, registry, service).Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("Server läuft auf http://localhost%s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server-Fehler: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Shutdown: %v", err)
	}
	log.Println("Server beendet")
}
