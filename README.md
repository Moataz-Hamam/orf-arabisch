# نافذة فيينا — ORF auf Arabisch

Statische Nachrichten-Website: holt den offiziellen ORF-RSS-Feed, übersetzt die Titel **journalistisch** (nicht wörtlich) ins Arabische und veröffentlicht sie als RTL-Seite.

Live nach dem ersten Deploy typischerweise unter:

`https://<dein-github-user>.github.io/orf-arabisch/`

## Warum dieser Aufbau?

| Stück | Wahl | Grund |
| --- | --- | --- |
| Frontend | statisches HTML/CSS/JS in `public/` | Kein Build, schnell, RTL-sicher, überall hostbar |
| Daten | `public/data/news.json` | Strukturiert, versioniert, die Seite liest nur JSON |
| Übersetzung | OpenAI-kompatible Chat-API (`gpt-4o-mini` als Default) | Günstige, gute arabische Schlagzeilen; Cache vermeidet Doppelkosten |
| Automatisierung | GitHub Actions, alle 3 Stunden | Läuft in der Cloud, ohne dass dein Rechner an sein muss |
| Hosting | **GitHub Pages** | Kostenlos, HTTPS, koppelt sich natürlich an das Repo. Vercel wäre möglich, bräuchte aber extra Cron + Speicher — hier wäre das Overkill. |

Der API-Schlüssel liegt **nur** in GitHub Secrets bzw. lokal in `.env`, niemals im Quellcode.

## Schnellstart lokal

Voraussetzung: [Node.js 20+](https://nodejs.org/) und ein [OpenAI-API-Key](https://platform.openai.com/api-keys) (oder ein kompatibler Endpunkt, z. B. Groq).

```bash
cd ~/orf-arabisch
cp .env.example .env
```

In `.env` den Schlüssel eintragen:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Feed holen, neue Titel übersetzen, JSON schreiben:

```bash
set -a && source .env && set +a
npm run update
npm run serve
```

Danach im Browser: [http://127.0.0.1:4173](http://127.0.0.1:4173)

Ohne API-Key startet `npm run serve` trotzdem — die Seite zeigt die mitgelieferte Beispieldatei. `npm run update` ohne Schlüssel aktualisiert den Feed, lässt neue Titel aber unübersetzt (in GitHub Actions schlägt das bewusst fehl).

## Öffentlich machen (GitHub Pages)

1. **GitHub-Konto** und ein **leeres öffentliches Repository** `orf-arabisch` anlegen.
2. Remote setzen und pushen:

```bash
cd ~/orf-arabisch
git add .
git commit -m "Erste Version: ORF-Nachrichten auf Arabisch"
git branch -M main
git remote add origin https://github.com/<DEIN-USER>/orf-arabisch.git
git push -u origin main
```

3. **Secret anlegen:** Repo → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*
   - Name: `OPENAI_API_KEY`
   - Wert: dein Schlüssel
   - Optional: `OPENAI_MODEL` (sonst `gpt-4o-mini`), `OPENAI_BASE_URL` (sonst OpenAI)

4. **Pages aktivieren:** *Settings* → *Pages* → *Build and deployment* → Source **GitHub Actions**.

5. Workflows anstoßen:
   - *Actions* → **GitHub Pages** → *Run workflow* (erstes Deploy)
   - *Actions* → **Nachrichten aktualisieren** → *Run workflow* (erster Live-Lauf mit API)

Danach aktualisiert der Scheduler **alle drei Stunden** (Minute 25) den Feed, schreibt JSON, committet und Pages baut neu.

Geplante Workflows laufen erst, nachdem sie mindestens einmal auf `main` gelegen haben. Beim allerersten Public-Repo kann GitHub den Cron ein paar Stunden verzögern — *Run workflow* umgeht das.

## Dateien

```
public/                 # die Website (Pages-Artefakt)
  index.html
  styles.css
  app.js
  data/news.json        # aktuelle Ausgabe
scripts/fetch-and-translate.mjs
data/translation-cache.json   # spart wiederholte API-Aufrufe
.github/workflows/update.yml  # Cron
.github/workflows/pages.yml   # Hosting
```

## Hinweise

- Es werden **Titel** übersetzt, nicht ganze Artikel. Der Link führt zum ORF-Original.
- Das ist **kein** offizielles ORF-Angebot; die deutschen Texte bleiben beim ORF.
- Übersetzungen können Fehler enthalten — bei Bedarf Prompt in `scripts/fetch-and-translate.mjs` anpassen.
