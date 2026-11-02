# Nilkanth Yatra

An interactive, 3D topographic retelling of the **Van Vicharan**, the seven-year walk Nilkanth Varni (Bhagwan Swaminarayan) made from Ayodhya to Loj between 1792 and 1799. It covers 65 tirths, from the Himalaya to Kanyakumari and on to Saurashtra.

The design follows the classic pilgrimage map: satellite relief, yellow numbered discs, a white dashed trail, and yellow-and-red city tags. On top of that it adds real terrain, hillshading, live contour lines and an animated walk.

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
- Toggle 3D terrain, contours, follow-cam; adjust relief exaggeration and speed

## Stack

- [MapLibre GL JS](https://maplibre.org/) 4.7 with raster-dem terrain and hillshade
- [maplibre-contour](https://github.com/onthegomap/maplibre-contour), which generates contour lines on the fly from the DEM
- Esri World Imagery for the base, AWS/Mapzen Terrarium tiles for elevation
- Stop data lives in `js/stops.js`. Coordinates are best-effort identifications, and uncertain ones are flagged `approx`.
