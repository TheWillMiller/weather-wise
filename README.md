# Weather Wise

![Weather Wise dashboard preview](docs/preview.png)

Weather Wise is a Home Assistant dashboard card for a polished weather panel with current conditions, hourly and daily forecasts, sunrise and sunset, wind, humidity, and an optional NOAA radar loop.

## Features

- Custom Lovelace card: `custom:weather-wise-card`
- Uses your existing Home Assistant `weather` entity
- No long-lived access token or custom backend integration required
- Hourly forecast strip
- Daily or twice-daily forecast cards
- NOAA radar map overlay with configurable location
- Responsive layout for wall panels, tablets, and narrower dashboard columns

## HACS installation

### Custom repository

1. Open HACS in Home Assistant.
2. Open the three-dot menu and select **Custom repositories**.
3. Add `https://github.com/TheWillMiller/weather-wise`.
4. Select **Dashboard** as the repository type.
5. Install **Weather Wise**.
6. Refresh the browser after HACS adds the dashboard resource.

### Manual installation

1. Copy `dist/weather-wise.js` to `/config/www/community/weather-wise/weather-wise.js`.
2. Add this dashboard resource:

```yaml
url: /local/community/weather-wise/weather-wise.js
type: module
```

## Usage

```yaml
type: custom:weather-wise-card
entity: weather.home
name: Home
latitude: 33.688
longitude: -78.886
```

## Options

| Name | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `entity` | string | yes | none | Home Assistant weather entity to display. |
| `name` | string | no | `Home` | Display location name. |
| `latitude` | number | no | Home Assistant latitude | Radar center latitude. |
| `longitude` | number | no | Home Assistant longitude | Radar center longitude. |
| `hourly_count` | number | no | `8` | Number of hourly forecast rows. |
| `show_radar` | boolean | no | `true` | Show or hide the NOAA radar map. |
| `show_map_controls` | boolean | no | `true` | Show or hide map zoom controls. |
| `radar_zoom` | number | no | `7` | Initial radar map zoom level. |

## Notes

Weather Wise uses Home Assistant's frontend connection to call `weather.get_forecasts`. It also reads `sun.sun` when available for sunrise and sunset. Radar tiles come from NOAA and the base map comes from OpenStreetMap/CARTO, so the radar panel requires network access from the browser viewing the dashboard.

## HACS default-store submission checklist

- Repository is public on GitHub.
- Repository description is set.
- Repository topics are set, for example: `home-assistant`, `hacs`, `lovelace`, `custom-card`, `weather`.
- Issues are enabled.
- HACS validation workflow passes.
- README includes usage instructions and a preview image.
- A GitHub release exists, not only a tag.
- Add `TheWillMiller/weather-wise` alphabetically to the `plugin` file in `hacs/default`.

## Development

This repository is intentionally zero-build. Edit `dist/weather-wise.js` directly and reload the Home Assistant dashboard resource during development.
