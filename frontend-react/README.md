# MemorAid — Frontend (React + Vite)

The client for the MemorAid (IMRS) prototype. A single-page React application
that talks to the Flask REST API in `../backend`.

The document of proof (line 107) specifies the frontend languages as **HTML,
CSS and JavaScript**; this application is written in exactly those languages.
React and Vite are *tooling*, not a different language, and were chosen so the
project demonstrates the component architecture, routing, state management and
build pipeline expected of a final-year Computer Science project.

---

## Requirements

- Node.js 18+ (developed on Node 24)
- The backend running on `http://127.0.0.1:5000` (see `../README.md`)

## Running in development

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>.

Vite proxies any request to `/api` through to the Flask backend (configured in
`vite.config.js`), so the browser only ever talks to one origin during
development. To point at a different API host instead, set `VITE_API_BASE`:

```bash
# .env.local
VITE_API_BASE=http://127.0.0.1:5000
```

## Building for production

```bash
npm run build      # emits dist/
npm run preview    # serves dist/ locally to check the build
```

`dist/` is a static bundle that can be served by any web server. To have the
Flask backend serve it directly (single-process demo), copy or symlink `dist/`
as `../frontend/` — the backend already serves that directory if it exists.

## Linting

```bash
npm run lint       # oxlint
```

---

## Architecture

```
src/
  main.jsx              entry point — mounts <App/>
  App.jsx               composition root (AuthProvider > Router > Routes)
  router.jsx            the route table
  context/
    AuthContext.jsx     who is signed in; the only place the token is managed
  lib/
    api.js              the entire REST client — no fetch() calls elsewhere
    ui.jsx              shared presentational helpers (toast, form messages, …)
  components/
    AppLayout.jsx       signed-in shell: sidebar + topbar + <Outlet/>
    PublicLayout.jsx    signed-out shell: top navigation + <Outlet/>
    RequireAuth.jsx     route guard for authenticated areas
    A11yBar.jsx         text-size and high-contrast controls
    Charts.jsx          hand-written SVG bar and line charts
  pages/                one component per screen (11 screens)
  styles/
    global.css          design system + the document's accessibility rules
```

### Why this structure

- **One API layer.** Every network call goes through `lib/api.js`. Components
  never call `fetch()` directly, so auth, error handling and the base URL are
  defined once. The previous plain-HTML build duplicated that logic per page.
- **One auth story.** `AuthContext` holds the signed-in user. Pages read it
  with `useAuth()` rather than each reading `localStorage` independently.
- **One navigation.** The sidebar and topbar live in `AppLayout` and appear on
  every signed-in page automatically — no copy-pasted markup.
- **Route-level code organisation.** Adding a screen means adding one component
  and one line in `router.jsx`.

### Screens

| Route | Component | Purpose | Document refs |
|---|---|---|---|
| `/` | `Landing` | Public introduction | — |
| `/login` | `Login` | Sign in | FR-01 |
| `/signup` | `Signup` | Register | FR-01 |
| `/dashboard` | `Dashboard` | Morning check-in, streaks, recent memories | FR-14 |
| `/notifications` | `Notifications` | All check-in and reminder messages, read state, delete | FR-14, FR-15 |
| `/log-memory` | `LogMemory` | Record a memory; generates a question | FR-03, FR-04 |
| `/recall` | `Recall` | Recall session: question → reveal → rate → summary | FR-05, FR-06, FR-07 |
| `/exercises` | `Exercises` | Guided memory exercises (six techniques) | FR-08 |
| `/chat` | `Chat` | AI companion conversation | FR-09–FR-11 |
| `/analytics` | `Analytics` | Accuracy, forgetting by category, trends | FR-13 |
| `/profile` | `Profile` | Details and accessibility preferences | FR-02 |

---

## Accessibility

The document (section 3.5.2) sets binding accessibility requirements. They are
implemented in `src/styles/global.css` and enforced in the components:

| Requirement | Where |
|---|---|
| Inputs at least 56px tall | `--input-height` in `global.css` |
| Labels always above the field | `form-group label` rule; no placeholder-only fields |
| Body text at least 18px | `--body-font-size` |
| Headings at least 24px | `h1`/`h2` sizing |
| Plain-language errors | `FormMessage` component |
| Password show/hide | `PasswordField` component |
| Text-size and contrast presets | `A11yBar` component; presets multiply all `font-size` values via `--font-scale-text` |
| Keyboard-operable controls | native buttons; visible `:focus-visible` outlines |
| Skip-to-content link | first element in `App.jsx` |
