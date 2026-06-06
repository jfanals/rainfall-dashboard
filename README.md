# Rainfall Dashboard

A modern React dashboard for recent rainfall readings from UK Environment Agency flood-monitoring stations.

## Features

- Full-screen map-first interface for Environment Agency rainfall stations
- Interactive OpenStreetMap layer coloured and sized by today’s rainfall
- Hover a station for a tiny 7-day rainfall chart
- Click a station to split the screen and show a simple rainfall panel
- 30-day chart by default, with 7 / 14 / 30 day toggles
- Optional browser location centring
- 7, 14, 30 and 90 day views
- Summary cards for today, rolling totals, wettest day and rain days
- Responsive SVG bar chart and detailed data table
- Cloudflare Worker API proxy with edge caching

## Development

```bash
npm install
npm run dev
```

The Vite dev server falls back to the public Environment Agency API when the local Worker API is not running.

## Cloudflare Workers deployment

```bash
npm run deploy
```

This runs a production build and deploys the Worker configured in `wrangler.toml`. The Worker serves the built React assets and exposes cached API endpoints under `/api/stations`, `/api/map-rainfall`, and `/api/rainfall`.

## Useful scripts

- `npm run dev` - start the Vite development server
- `npm run build` - type-check and build the React app
- `npm run preview` - build and run locally through Wrangler
- `npm run deploy` - build and deploy to Cloudflare Workers
