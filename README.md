# Nilkanth Yatra

An interactive, 3D topographic retelling of the **Van Vicharan**, the seven-year walk Nilkanth Varni (Bhagwan Swaminarayan) made from Ayodhya to Loj between 1792 and 1799. It covers 65 tirths, from the Himalaya to Kanyakumari and on to Saurashtra.

Two map styles:

- **Atlas** (default): land is colored by real elevation and the sea by real depth, with soft shaded relief, live contour lines, rivers and borders.
- **Satellite**: toned-down Esri imagery draped on the same 3D terrain.

The gold numbered stops and dashed trail are a nod to the classic printed pilgrimage map.

## Night sky

Each stop's card has a **Night sky** section. It shows the sky over that town on the night he was there: about 2,850 naked-eye stars, the Milky Way, constellation figures, the planets and the Moon at its real phase. Positions are computed with [astronomy-engine](https://github.com/cosinekitty/astronomy). It also shows the **tithi** (lunar day) and the **Moon's nakshatra** (Lahiri ayanamsa). A slider runs from dusk to dawn.

**Look up ↑** stands you in the town: a first-person camera 120 m above the real terrain at true scale, with a 60° field of view. The star dome is drawn behind the map canvas, so the actual mountains hide the stars behind them. Drag to turn your head.

**About the dates.** Only the start and end are fixed by tradition, and both tithis check out astronomically:

| | Traditional | Computed |
|---|---|---|
| Leaves Ayodhya, 29 Jun 1792 | Ashadh sud 10 | Shukla 10 |
| Arrives Loj, 21 Aug 1799 | Shravan vad 6 | Krishna 6 |

The middle dates are **estimates** (shown with ≈). They spread the seven years along the route and include the long stays described in BAPS / swaminarayan.org biographies: about 2½ months at Muktinath, 9 months with Gopal Yogi (finishing in 1794) and about 6 months at Jagannath Puri. To correct a date, edit `OVERRIDES` in `js/chronology.js`.

## Run

No build step. ES modules need a local server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

- **Space**: play / pause the journey (the camera follows the traveler)
- **← / →**: previous / next tirth
- Click any marker or list item to fly there
- Drag the timeline to scrub through the journey
- Switch Atlas / Satellite; toggle 3D, contours, follow-cam; adjust relief and speed
- Click a region on the timeline to jump to its first stop

## Stack

- [MapLibre GL JS](https://maplibre.org/) 5.24 for the 3D terrain, hillshade and `color-relief` elevation coloring
- [maplibre-contour](https://github.com/onthegomap/maplibre-contour), which generates contour lines on the fly from the DEM
- AWS/Mapzen Terrarium tiles for elevation (including sea depths), OpenFreeMap vector tiles for water, rivers and borders, and Esri World Imagery for the satellite style
- Star catalog, constellation lines and Milky Way contours come from [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD-3). Rebuild them with `node tools/build-sky.mjs`.
- Stop data lives in `js/stops.js`. Coordinates are best-effort identifications, and uncertain ones are flagged `approx`.
