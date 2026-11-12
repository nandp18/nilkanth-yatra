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

## Print edition

`print.html` (the **Print map** link in the app) draws an antique-style chart of the whole journey as a single vector SVG:
- relief engraved from elevation tiles at about 220 dpi
- water-lined coasts and a degree-ruled border
- compass rose and scale bar
- the 65 tirths keyed in the Indian Ocean, as on the original map

Six map styles, each with its own relief, palette and paper (`STYLES` in `js/print.js`; open one directly with `print.html?style=night`):
- **Antique** (default): the engraved sepia chart.
- **Natural**: natural-colour shaded relief, after Tom Patterson's National Park Service maps.
- **Watercolor**: soft pigment washes with pooled edges on cold-press paper, after Molly O'Halloran.
- **Cyanotype**: everything in Prussian blue and paper white, after Daniel Huffman's sun-printed cyanotypes.
- **Night**: moonlit relief and a glowing lantern route, after Anna Eshelman's Wonderland Trail map.
- **Pahari**: painted like a Kangra/Pahari miniature. It has flat, outlined grounds, little snow-capped peaks, hillocks and trees placed from the real terrain, rippled water, and a lapis band on a gold-flecked pink margin.

Seven layouts. Every one works in every style and at every size:
- **Classic**: title block, map, numbered key, legend and a chronicle timeline.
- **Map**: almost no text. The map fills the sheet, extended to its proportions (more sea to the south, more Tibet to the north), and a small title cartouche sits in the Arabian Sea corner. All 65 stops are named on the map, with leader lines where they crowd, and there's no key. Open it directly with `print.html?layout=map`.
- **Detail**: one region at a large scale, with every stop named. Choose the region: Himalaya & Nepal (stops 1–18), East (19–29), South (30–51) or West (52–65), e.g. `print.html?layout=detail&region=south`. The cartouche and compass take the emptiest corners, the scale bar picks a round length that fits, and the relief is fetched at about 260 dpi or better.
- **Strip**: a road-book after John Ogilby. The route is cut into twelve strips of about equal length, each turned to whichever angle fills it largest and read from the bottom up. Each strip has its own north arrow and scale.
- **Profile**: the height of the ground along the route, unrolled in four rows. It shows every tirth, the new year as it passes, and the highest ground crossed. Heights use a stretched scale so the Deccan reads beside the Himalaya; the gridlines carry the true values.
- **Panorama**: a bird's-eye view from above the Indian Ocean, looking north, ray-cast from the elevation data in the style's colours. Heights are exaggerated about 36×, and the route is dotted where it passes behind mountains. A key of all 65 tirths sits beneath.
- **Line**: a minimal poster. It shows the route as one bold line, the coast as a hairline, the milestones in small capitals and a large quiet title.

Formats are **12 × 16 in**, **18 × 24 in**, **24 × 36 in** and **A2**, plus an **8.5 × 11 in test** sheet that prints inside ¼ in margins on a home printer (`print.html?size=letter`). Every format carries the same content: the stops named on the 18 × 24 in reference sheet are named on all of them. Each one lays out separately:
- Type is sized for viewing distance.
- As many stop names are placed as fit without colliding.
- The map narrows if the sheet is short.
- Taller sheets get a *Chronicle of the Journey* timeline.

The 24 × 36 in poster engraves its relief from twice-as-detailed tiles (about 270 dpi). The title face can be Didone (the default), Garamond, Copperplate or Fell.

To get a file: **Print / Save PDF** (set margins to *None* and turn on *Background graphics*), or **Download SVG**. The SVG has its fonts embedded, so a print shop sees exactly what you see.

## Run

No build step. ES modules need a local server:

```sh
npm start            # python3 -m http.server 8000, then open http://localhost:8000
```

## Project layout

```
index.html            interactive map
print.html            print edition
css/                  app.css, print.css
js/
  app.js              map, playback engine, labels, UI
  weather.js          weather overlay + live elevation sampling
  sky.js              night sky (astronomy, chart, 3D dome); loaded on demand
  chronology.js       estimated date for each stop
  print.js            print edition renderer: styles, relief, Classic / Map / Detail sheets
  print-views.js      the other print views: Strip, Profile, Panorama, Line
  data/
    stops.js          the 65 tirths, cities, map labels
    skydata.js        generated: star catalog       (npm run build:sky)
    printdata.js      generated: coastline, rivers  (npm run build:print)
tools/                data generators
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
- Coastlines and rivers for the print edition come from [Natural Earth](https://www.naturalearthdata.com/) (public domain).
- Star catalog, constellation lines and Milky Way contours come from [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD-3). Rebuild them with `node tools/build-sky.mjs`.
- Stop data lives in `js/data/stops.js`. Coordinates are best-effort identifications, and uncertain ones are flagged `approx`.
