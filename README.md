# StueveCast — Model Sounding Diagram

Stüve / Emagram / Skew-T diagrams from numerical weather model profiles for any place
and forecast hour, with the chart and the fourteen analytics fields of the
**S2 Radiosonde Sounding Diagram** tool. Runs as a web app (PWA) on phone, iPad and desktop,
hosted on GitHub Pages, no backend.

## Deploy on GitHub Pages

1. Create a repository (suggested name `stuevecast`) and push the content of this folder to its root
   (`index.html` must be in the repository root, or in `docs/` if you publish from `docs/`).
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/stuevecast/`.
4. Homescreen: iPad/iPhone Safari → Share → *Add to Home Screen*; Android Chrome → menu → *Install app*.

All paths are relative, so any sub-path or a custom domain works. When you change files, bump
`VERSION` in `sw.js` (and `APP_VERSION` in `js/app.js`) so installed clients pick up the new shell.

## What is in the box

```
index.html               single-screen cockpit: collapsible left column (map · time · models), centre (model chips,
                         diagram radios, chart, panels), right column (facts · surface & model diagnostics ·
                         analytics · comments), hamburger settings menu, overlays
css/s2-base.css          S2 stylesheet (themes, chart card, stat strips, info modal, print)
css/app.css              cockpit layout: three columns with side handle, dense right column, chips, segmented radios,
                         hamburger menu, phone drawer, one-page print
js/core.js               S2 physics & indices (LCL/CAPE/CIN/LI/DCAPE/PW/K-index/Theta-E/shear), unit helpers, wind barbs;
                         shared `state`; level-based inversion / isothermal / cloud-layer detection
js/info.js               the fourteen field explanations from S2 (verbatim) + "Model data note" per field
js/draw.js               S2 chart engine (Stüve/Emagram/Skew-T, wind-speed panel with resize handle, barb column,
                         hodograph, Theta-E and vertical-velocity mini profiles, cursor sync), compact phone layout,
                         dots on real model levels
js/analytics.js          S2 analytics strip, traffic-light comments, info modal
js/models.js             model catalog (Open-Meteo keys, coverage boxes, level lists, cycle/latency, default rule)
js/openmeteo.js          Open-Meteo requests with self-healing variable lists, adapter model → S2 rows,
                         geocoding, elevation/time zone, reverse geocoding
js/app.js                cockpit logic: map with crosshair, one time slider (day chips, ‹ ›, play, native picker),
                         model list + dynamic chips, auto-load, touch inspect & pinch zoom, wind-handle drag,
                         settings menu, share link/QR, PNG export, print, session/favorites, service worker
sw.js                    offline: app shell precache, Open-Meteo network-first with cache fallback, tile cache
manifest.webmanifest     PWA manifest (standalone, icons incl. maskable)
icons/, img/             icon set (SVG, ICO, 180/192/512, maskable) and the Ballonteam logo
test/run.js              node harness: catalog, pruning, adapter, analytics, drawing (fake canvas)
test/integration.js      jsdom walk-through of all three screens (npm install jsdom inside test/)
```

The S2 code keeps its data contract: every profile is an S2 `rows` array
`[time, altMSL_m, p_hPa, T_C, RH_pct, Td_C, windSpeed_ms, windHeading_deg, lat, lon, verticalVelocity, interp, kind]`
where `kind` is `sfc` (2 m surface point), `lvl` (pressure level) or `agl` (80/120/180 m wind level).
The selected primary model fills `state.rows`; the other selected models fill `state.compareFlights`,
which the S2 chart already knew how to draw as dashed comparison curves.

## Data flow

1. **Place** – map centre under the crosshair, place search (Open-Meteo geocoding), GPS, favorites.
   Elevation and time zone come from one cheap Open-Meteo call, the place name from Nominatim.
   Search results, favorites and GPS load the profile immediately; after panning the map, **Load** does.
2. **Time** – one slider over every hour up to the longest model horizon (16 days), in the location's
   time zone: day chips jump, ‹ › step, ▶ animates, the date label opens a native date/time picker.
3. **Models** – the left list shows every catalog model with coverage, grid, levels, estimated run and
   horizon (★ = primary). Chips above the chart show the models that cover the place *and* the chosen
   hour; they appear and disappear as the slider enters or leaves a model's horizon. Tap a chip to add a
   model (fetched on demand), × to remove it, tap a comparison chip to make it primary. Default = finest
   grid with the newest run; up to four models at once.
4. **Fetch** – one request per model for its whole horizon (`timezone=UTC`, `timeformat=unixtime`,
   `wind_speed_unit=ms`), plus one "extras" request (CAPE, LI, CIN, freezing level, PBL height,
   80/120/180 m winds, vertical velocity). Variables a model does not support are removed automatically
   (Open-Meteo answers with `invalid String value <variable>`), and the working lists are cached per model.
5. **Adapter** – 2 m values become the ground row, levels below the model ground are dropped,
   heights come from geopotential height (hypsometric fallback), dew point from RH (Magnus).
6. **Slider** – every hour is rebuilt from the cached arrays, so scrubbing and playback work offline.
7. **Layout** – the chart takes the height that is left in the centre column; ‹ hides the left column
   to give the chart more width. Below 1000 px (phones) the left column becomes a drawer and the page
   scrolls. Printing produces one A4 page: chart, optional panels, then the right-column blocks.

## Known limits (v1)

* Model profiles have 9–28 pressure levels; dots mark the real levels, everything in between is interpolated.
  Thin inversions and the exact LFC/CIN are less certain than in a radiosonde ascent.
* Open-Meteo does not expose the model run time; the run shown is estimated from cycle + latency.
* MeteoSwiss ICON-CH1/CH2 are listed but have no pressure levels on Open-Meteo yet.
* The level lists in `js/models.js` are starting points; unsupported levels are pruned at runtime
  (one extra request per unsupported level on first use). If a model gains levels, add them to `LEVEL_SETS`.
* Free Open-Meteo tier: 10,000 "calls" per day; a full multi-level, multi-day request counts as several.
  A commercial key can be entered in the settings (switches to `customer-api.open-meteo.com`).

## Planned for v2

* **ICON-CH1/CH2 vertical profiles** through a small Cloudflare Worker that reads the native MeteoSwiss
  open-data GRIB files (model levels → pressure levels), served in the same JSON shape as Open-Meteo so
  `openmeteo.js` can consume it with a different base URL.
* **Radiosonde comparison** (SondeHub live sondes / Payerne 06610) as a fourth comparison curve.
* Time–height strip under the slider (RH shading over the forecast period) as a navigation aid.

## Tests

```
node test/run.js                 # unit-level: catalog, pruning, adapter, analytics, drawing
cd test && npm install jsdom     # once
node test/integration.js         # walks through the app in jsdom
```

## License and credits

Custom license (not open source), analogous to the S2 tool: using the app is permitted; modifying,
redistributing or publishing derivative versions needs the copyright holder's prior written permission
and must keep attribution. Weather data by [Open-Meteo](https://open-meteo.com) (CC BY 4.0). Map tiles ©
OpenStreetMap contributors and OpenTopoMap (CC BY-SA). Includes Leaflet (BSD-2-Clause) and qrcodejs (MIT).
