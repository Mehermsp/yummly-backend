TastieKit Backend

This backend is now structured with **`src/` as the single runtime source of truth**.

## Run

1. Configure environment
   - Set DB credentials in `backend/.env`
   - Use `backend/.env.example` as template
2. Start API
   - `npm start`
3. Dev mode
   - `npm run dev`

## Active code paths (edit these)

- `backend/src/server.js` -> bootstraps API server
- `backend/src/app.js` -> Express app setup
- `backend/src/routes/*` -> API routes
- `backend/src/controllers/*` -> request handlers
- `backend/src/models/*` -> DB access logic
- `backend/src/middleware/*` -> auth/authorization/error middleware
- `backend/src/config/*` -> env + DB configuration
- `backend/src/utils/*` -> shared helpers

## Compatibility entry files

- `backend/server.js`
- `backend/app.js`
- `backend/index.js`

These files are thin wrappers kept only for backward compatibility.

Legacy non-`src` code folders have been removed to reduce confusion.
Use only `backend/src/*` for backend API and business-logic changes.
