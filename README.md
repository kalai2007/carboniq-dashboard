# CarbonIQ Emissions Dashboard

A minimal white-themed Flask dashboard for cement and electricity carbon emissions, historical batch analysis, monthly CO₂ release, and reduction recommendations.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>.

Demo accounts:

- `admin / admin123`
- `engineer / carbon2026`

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and select the repository.
3. Render will use `render.yaml` and the included `Procfile`.
4. Set a strong `SECRET_KEY` if Render does not generate one automatically.
5. Open the generated web service URL.

The default Render configuration uses SQLite on the service filesystem. Free web services may lose local SQLite data during redeploys. For durable history, attach a Render disk and set `DATABASE_PATH` to a path on that disk, such as `/var/data/carboniq.db`.

The seeded demo accounts are intended for evaluation only. Replace or remove them before using the app with real plant data.
