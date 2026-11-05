# Deploying Notebook Companion (Render)

You get a public **https://…onrender.com** link (https is required for the microphone). Every `git push` redeploys automatically; your notebooks live on a disk that survives redeploys.

## 1. Put the code on GitHub (once)
```
cd notebook-companion-v5
git init
git add .
git status            # check: backend/.env and *.db must NOT be listed (.gitignore keeps them out)
git commit -m "Notebook Companion"
```
Create an empty **private** repository on github.com, then:
```
git remote add origin https://github.com/<you>/notebook-companion.git
git branch -M main
git push -u origin main
```

## 2. Create the service on Render (once)
1. Sign in at https://render.com with GitHub.
2. **New → Blueprint**, pick the repository. Render reads `render.yaml`: a Docker web service with a 1 GB disk at `/data`.
3. Fill in the secret values it asks for (copy them from your `backend/.env`):
   - `APP_ACCESS_CODE`: a long code you invent; people type it once to open the app
   - `GNANI_API_KEY`, `LLM_API_KEY` (Gemini), `LLM2_API_KEY` (Groq)
4. **Apply**. The first build takes ~5 minutes. Open the link, enter the access code.

Cost: the disk needs a paid instance (Render "Starter", about $7/month). The free instance works for a quick demo but **forgets all notebooks whenever it restarts or redeploys**, and sleeps when idle (first load ~1 min).

## 3. Making changes after deployment
```
(edit the code)
cd frontend && npm run build && cd ..           # only to check it builds
backend\.venv\Scripts\python.exe tests\e2e.py   # must say 30/30 passed
git add . && git commit -m "what you changed" && git push
```
Render rebuilds and switches over in a few minutes; notebooks on the disk are kept. To change a key or setting: Render dashboard → the service → **Environment** → edit → it restarts by itself. If a change breaks something: Render → **Events** → pick the previous deploy → **Rollback**.

## 4. Looking after the data
- Automatic backups are written to `/data/backups` every 6 hours (newest 14 kept), on the same disk.
- For an off-site copy, use Home → **Download all notebooks** now and then; **Restore from a backup file** brings them back on any copy of the app.

## Good to know
- One shared library: everyone with the access code sees the same notebooks. Separate accounts per person are not built yet.
- The AI and Gnani keys are used by everyone who has the code, so give it only to people you trust, and keep the Groq backup configured for when Gemini is rate-limited.
- Logs: Render → the service → **Logs**. Health check: `/api/health`.
