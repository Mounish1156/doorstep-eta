# Doorstep — Food Delivery Time Estimator (ML)

Flask + scikit-learn app that predicts delivery time (minutes) from distance, prep time,
courier experience, vehicle, traffic, weather and time of day.

## Run locally
    pip install -r requirements.txt
    python train.py        # trains + saves model.joblib, metrics.json
    python app.py          # http://127.0.0.1:5000

Use your own data: put a CSV at `data/delivery.csv` with columns
Distance_km, Weather, Traffic_Level, Time_of_Day, Vehicle_Type,
Preparation_Time_min, Courier_Experience_yrs, Delivery_Time_min, then re-run `python train.py`.

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render dashboard → New → Blueprint → pick the repo (it reads `render.yaml`).
   Or New → Web Service with Build `pip install -r requirements.txt && python train.py`,
   Start `gunicorn app:app --bind 0.0.0.0:$PORT`.
3. Open the URL Render gives you. Health check: `/health`.

## UI — "THE PASS"

The screen is split like a restaurant pass: **a thermal order ticket** on the left (you
fill it in) and **a dark split-flap departure board** on the right (it answers). The
ticket laps over the board's edge, is tilted a degree, and has torn perforated top and
bottom edges, paper grain (inline-SVG turbulence), a random order number and a live
kitchen clock.

**How the pieces are built** — plain HTML/CSS/vanilla JS, no build step, no images:

- **Ruler scrubbers** — Distance, Kitchen prep and Courier hand are tape-measure
  rulers (hanging ticks + numeric labels drawn from each `<input type="range">`'s real
  min/max/step). The red pointer is cosmetic; the native range underneath still gets
  keyboard, touch and screen-reader support (`aria-valuetext` carries the unit).
- **Stamp selectors** — Vehicle, Traffic, Weather and Time of day are real radio
  groups. The checked one gets an imperfect rubber-stamp mark: rotated a few degrees,
  tomato ink pushed through an SVG turbulence/displacement filter, with a quick press
  animation. Every option uses a hand-drawn inline-SVG pictogram (no emoji).
- **Split-flap board** — ETA digits and "LANDS AT" are CSS 3D cards. On each update the
  top card falls away (240 ms), the new bottom card swings in and lands (270 ms),
  staggered 55 ms per digit. A mechanical tick sound is available behind the **Tick**
  toggle and is **off by default**. While waiting, the flaps shuffle.
- **The run** — a hand-drawn winding SVG path from a kitchen pin to a house pin. Its
  three sections are sized by the prediction's real `prep` / `handoff` / `ride` split,
  draw in with `stroke-dashoffset`, and a courier marker travels the path with
  `getPointAtLength()`; stage labels sit in little plates on the path.
- **Time of day** — Morning / Afternoon / Evening / Night shift the whole page's
  palette and the board's sky strip through CSS custom properties (pale dawn → bright
  noon → amber dusk → deep ink night). The ticket always stays paper-colored.
- **What would change it** — after each estimate the client silently predicts the other
  two vehicles and one-step-better/worse traffic (debounced, stale requests aborted)
  and lists them as `+5 min` / `−3 min`.
- **Recent tickets** — the last five estimates live in memory (never localStorage) as
  clickable stub tickets that re-fire the same order.
- **Under the hood** — a drawer comparing the three models on MAE / RMSE / R² with
  hand-built SVG bars, the winner highlighted, plus a plain-language note and the
  training row count, all from `metrics.all` in `metrics.json`.
- **States** — empty (blank flaps), loading (flaps shuffle), error (**DELAYED** letter
  flaps plus the server's own message, never `alert()`), and a slow request times out
  into the same DELAYED state. `Copy ETA` copies a friendly line and shows a toast.

Motion is 150–700 ms with physical logic and a single coordinated entrance, and all of
it switches off under `prefers-reduced-motion`. Layout is asymmetric/editorial on
desktop (ticket overlapping the board), board-first on tablet, and on mobile a sticky
compact board strip (ETA + lands-at) sits above the ticket with the drawer as a bottom
sheet. Everything is keyboard-operable with visible focus rings, real inputs under the
custom visuals, `aria-live` on the result, AA contrast and ≥44 px touch targets.

