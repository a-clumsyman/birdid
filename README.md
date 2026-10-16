# Bird ID

Mobile-first web app: record birdsong with your phone, get the species from BirdNET, keep a private log, life list and sightings map.

- `web/` static app (Vercel). Sign-in with Clerk (email code + Google), wired to Supabase as a third-party auth provider; Postgres and private audio storage with row-level security per Clerk user id.
- `app.py` + `Dockerfile` FastAPI + BirdNET backend (Render free). `POST /identify` for the phone, `POST /ingest` for a 24/7 field device that sends already-isolated bird-call clips.
- `schema.sql` database schema, policies and storage bucket.

BirdNET models are CC BY-NC-SA 4.0: personal, non-commercial use.
