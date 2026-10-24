# Supabase Setup for MemorAid

## 1) Create a Supabase project
Create a project at https://supabase.com. Get the connection string (use "Direct connection" or "Transaction pooler" as appropriate).

## 2) Set environment variables
In your deployment (Vercel/Render/Railway) or `backend/.env`, set:
```env
DATABASE_URL=postgresql+psycopg2://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require
SECRET_KEY=your-random-secret
JWT_SECRET_KEY=your-random-jwt-secret
GEMINI_API_KEY=your-gemini-key
```

Note: If using Supabase pooler (port 6543), also works. Add `sslmode=require`.

## 3) Initialize schema
Run the schema on Supabase:
```bash
psql "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require" -f backend/db/schema.sql
```

Or use Supabase SQL Editor and paste contents of `backend/db/schema.sql`.

## 4) Run migrations/seed
The app will call `db.create_all()` and `db.migrate.ensure_schema()` on startup and seed data. That's fine.

## 5) Notes for Vercel
- Set all env vars in Vercel project settings
- Scheduler won't run on serverless; use external scheduler (cron-job.org) calling endpoints or disable
- File uploads/storage not used; instance/ is ephemeral
