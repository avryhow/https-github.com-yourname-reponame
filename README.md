# Todo (Flask + Vercel Postgres)

A Flask + Vercel Postgres todo app with the full feature set of the original `todo-app` project (priority, category, deadline, daily/weekly repeat, drag-to-reorder, dark/light theme, JSON export/import, per-task QR-code complete links), served as a single-page frontend backed by a same-origin JSON API (`/tasks`).

## Deploy

1. `vercel link` (or just `vercel`) from this folder to create the project.
2. In the Vercel dashboard, add the **Postgres** storage integration to the project — this sets the `POSTGRES_URL` env var automatically.
3. `vercel --prod` to deploy. The table is created automatically on first request.

## Local development

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
vercel env pull .env.local   # after linking + adding Postgres, to get POSTGRES_URL locally
$env:POSTGRES_URL = (Get-Content .env.local | Select-String POSTGRES_URL).ToString().Split('=',2)[1].Trim('"')
python api/index.py
```

Runs at `http://localhost:5000`.
