# HACS submission notes

Weather Wise is a HACS Dashboard/plugin repository.

## Repository category

Use `plugin`, which appears as **Dashboard** in the HACS frontend.

## Custom repository URL

```text
https://github.com/TheWillMiller/weather-wise
```

## Default repository PR target

Add this line alphabetically to the `plugin` file in `hacs/default`:

```text
TheWillMiller/weather-wise
```

## Before opening the PR

1. Push this repository to GitHub.
2. Set the repository description:
   `Weather Wise Home Assistant dashboard card with forecasts and NOAA radar.`
3. Add repository topics:
   `home-assistant`, `hacs`, `lovelace`, `custom-card`, `weather`.
4. Make sure issues are enabled.
5. Confirm the HACS validation workflow passes.
6. Create a full GitHub release such as `v1.0.0`.
7. Open the PR from your personal fork of `hacs/default`, not an organization account.
