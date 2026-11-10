# Azubify

Aufgabenplattform für die Ausbildung: Ausbilder erstellen Aufgaben im Block-Editor, schalten Themen für Azubis frei und bewerten die Ergebnisse. Azubis bearbeiten die Aufgaben direkt im Browser – jede Eingabe wird automatisch gespeichert.

## Rollen
| Rolle | Rechte |
|---|---|
| **Admin** | alles, plus Benutzerverwaltung (Azubis und Ausbilder anlegen, Passwort zurücksetzen, deaktivieren, löschen) |
| **Ausbilder** | Themen und Aufgaben erstellen, Azubis freischalten, Abgaben prüfen, Lernfortschritt aller Azubis sehen |
| **Azubi** | freigeschaltete Aufgaben bearbeiten, abgeben, Ergebnisse einsehen |

## Funktionen
- Block-Editor: Überschrift, formatierter Text, Hinweis-Boxen, Code, Bilder, Trennlinie
- Fragetypen: Kurzantwort, Freitext, Single/Multiple Choice, Zahl (mit Toleranz), Lückentext
- Automatische Bewertung, wo eine Lösung hinterlegt ist; Freitext wird manuell bewertet (Punkte + Anmerkungen je Frage, Gesamtfeedback)
- Autospeichern im Editor und bei den Azubis (zusätzlich lokale Sicherung im Browser, falls Verbindung/Browser abbricht)
- Abgabe-Workflow: Bearbeiten → Abgegeben → Bewertet (oder „zur Überarbeitung zurückgeben“)
- Lösungen werden erst nach der Bewertung an Azubis ausgeliefert
- Hell/Dunkel automatisch, mobil nutzbar

## Deployment mit Portainer (ohne selbst zu bauen)
Bei jedem Push auf `main` baut GitHub Actions das Image `ghcr.io/flowoy96/azubify:latest` (amd64 + arm64).

1. **Registry in Portainer hinterlegen** (das Repo ist privat, daher ist das Paket privat):
   Portainer → *Registries* → *Add registry* → *Custom registry*, URL `ghcr.io`, Benutzer = GitHub-Name, Passwort = GitHub Personal Access Token (classic) mit Recht `read:packages`.
   *Alternative:* Paket auf GitHub unter *Packages → azubify → Package settings* auf „Public“ stellen, dann braucht es keine Zugangsdaten.
2. **Stack anlegen**: *Stacks → Add stack → Web editor*, Inhalt von [`docker-compose.yml`](docker-compose.yml) einfügen, `ADMIN_PASSWORD` ändern, deployen.
3. Aufrufen unter `http://<server>:3000`, mit `ADMIN_USER` / `ADMIN_PASSWORD` anmelden.

Daten (SQLite-DB + Bilder) liegen im Volume `/data` – dieses Volume sichern.

| Variable | Bedeutung | Standard |
|---|---|---|
| `ADMIN_USER` | Admin-Benutzername (nur beim ersten Start) | `admin` |
| `ADMIN_PASSWORD` | Admin-Passwort (nur beim ersten Start; ohne Angabe wird eines im Log ausgegeben) | – |
| `COOKIE_SECURE` | `true`, wenn hinter HTTPS-Reverse-Proxy | automatisch per Proxy-Header |
| `PORT` | Port im Container | `3000` |

Für HTTPS einen Reverse Proxy (Traefik, Nginx Proxy Manager, Caddy …) vorschalten.

## Entwicklung
```bash
npm install
ADMIN_PASSWORD=Admin12345 npm run dev   # http://localhost:3000
npm test
```
Voraussetzung: Node.js ≥ 22.13 (nutzt das eingebaute `node:sqlite`).
