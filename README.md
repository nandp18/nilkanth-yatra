# Nilkanth Yatra

An interactive, 3D topographic retelling of the **Van Vicharan**, the seven-year walk Nilkanth Varni (Bhagwan Swaminarayan) made from Ayodhya to Loj between 1792 and 1799. It covers 65 tirths, from the Himalaya to Kanyakumari and on to Saurashtra.

Two map styles:

- **Atlas** (default): land is colored by real elevation and the sea by real depth, with soft shaded relief, live contour lines, rivers and borders.
- **Satellite**: toned-down Esri imagery draped on the same 3D terrain.

The gold numbered stops and dashed trail are a nod to the classic printed pilgrimage map.

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
- Stop data lives in `js/stops.js`. Coordinates are best-effort identifications, and uncertain ones are flagged `approx`.
