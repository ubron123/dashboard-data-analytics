# Chess Openings Analytics

A Flask + Plotly + Three.js dashboard exploring opening popularity, player strength, and outcome patterns across thousands of games.

## Quick start (development)

```bash
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000.

By default the development server runs with **debug mode off** (safe). To enable the Werkzeug debugger and auto-reload for local work:

```bash
# Linux / macOS
FLASK_DEBUG=1 python app.py

# Windows (PowerShell)
$env:FLASK_DEBUG="1"; python app.py

# Windows (cmd)
set FLASK_DEBUG=1 && python app.py
```

Any other value (including unset) leaves debug **off**.

> ⚠️ Never run with `FLASK_DEBUG=1` on a publicly reachable interface. The Werkzeug debugger can execute arbitrary code if reached.

## Production

`app.run()` is the Flask development server and is not suitable for production. Use a real WSGI server.

### Linux / macOS — gunicorn

```bash
gunicorn -w 2 -b 0.0.0.0:8000 app:app
```

`-w 2` runs two worker processes; tune based on CPU count.

### Windows — waitress

```bash
waitress-serve --port=8000 app:app
```

Both servers ignore the `FLASK_DEBUG` env var by design — production = no debugger.

## Project layout

```
app.py              Flask routes + chart generation
openings.csv        Source data (~1.9k openings)
templates/
  dashboard.html    Single-page UI
static/
  style.css         Editorial chess-club theme
  dashboard.js      Filters, KPIs, chart wiring, modal
  scene3d.js        Three.js hero board + mini board
requirements.txt
```

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Renders the dashboard with the initial payload |
| POST | `/api/dashboard` | Returns KPIs, insights, chart JSON, and the top-50 opening list for the given filter body |
| GET | `/api/opening/<int:idx>` | Returns the full record for a single opening (used by the modal) |

The `/api/dashboard` body accepts: `search`, `eco`, `min_games`, `white_min`, `white_max`, `rating_min`, `rating_max`. Missing, null, empty, or non-numeric values fall back to defaults.
