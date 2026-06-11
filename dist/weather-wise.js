class WeatherWiseCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:weather-wise-card",
      entity: "weather.home",
      name: "Home",
      latitude: 33.688,
      longitude: -78.886
    };
  }

  static getConfigElement() {
    return document.createElement("weather-wise-card-editor");
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._forecasts = { hourly: [], daily: [], twice_daily: [] };
    this._forecastEntity = null;
    this._lastForecastLoad = 0;
    this._clockTimer = window.setInterval(() => this._updateClock(), 1000);
    this._radarTimer = null;
    this._radarReloadTimer = null;
    this._radarMap = null;
    this._radarLayers = [];
    this._radarIndex = 0;
  }

  disconnectedCallback() {
    window.clearInterval(this._clockTimer);
    this._teardownRadar();
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Weather Wise requires a weather entity.");
    }
    this._config = {
      name: "Home",
      hourly_count: 8,
      show_radar: true,
      show_map_controls: true,
      radar_zoom: 7,
      ...config
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const entityId = this._config.entity;
    const now = Date.now();
    if (entityId && this._forecastEntity !== entityId) {
      this._forecasts = { hourly: [], daily: [], twice_daily: [] };
      this._forecastEntity = entityId;
      this._lastForecastLoad = 0;
    }
    if (entityId && now - this._lastForecastLoad > 5 * 60 * 1000) {
      this._lastForecastLoad = now;
      this._loadForecasts(entityId);
    }
    this._render();
  }

  getCardSize() {
    return this._config.show_radar === false ? 5 : 8;
  }

  async _loadForecasts(entityId) {
    if (!this._hass?.connection?.sendMessagePromise) {
      return;
    }
    const types = ["hourly", "daily", "twice_daily"];
    const entries = await Promise.all(types.map(async (type) => {
      try {
        const response = await this._hass.connection.sendMessagePromise({
          type: "call_service",
          domain: "weather",
          service: "get_forecasts",
          service_data: { type },
          target: { entity_id: entityId },
          return_response: true
        });
        return [type, this._extractForecast(response, entityId)];
      } catch (err) {
        return [type, []];
      }
    }));
    this._forecasts = Object.fromEntries(entries);
    this._render();
  }

  _extractForecast(response, entityId) {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.forecast)) return response.forecast;
    const serviceResponse = response.service_response || response.response || response;
    const byEntity = serviceResponse?.[entityId] || Object.values(serviceResponse || {})[0];
    return Array.isArray(byEntity?.forecast) ? byEntity.forecast : [];
  }

  _render() {
    if (!this.shadowRoot || !this._config.entity) return;
    const stateObj = this._hass?.states?.[this._config.entity];
    const attrs = stateObj?.attributes || {};
    const condition = stateObj?.state || "unavailable";
    const locationName = this._config.name || attrs.friendly_name || "Home";
    const temp = this._formatNumber(attrs.temperature);
    const humidity = this._formatNumber(attrs.humidity);
    const wind = this._formatWind(attrs);
    const hourly = this._forecasts.hourly || [];
    const daily = this._forecasts.daily || [];
    const mainPeriods = (this._forecasts.twice_daily || []).length
      ? this._forecasts.twice_daily
      : daily.length ? daily : hourly;
    const hiLo = this._formatHiLo(daily, hourly);
    const sun = this._hass?.states?.["sun.sun"]?.attributes || {};
    const now = new Date();
    const unavailable = !stateObj || condition === "unavailable" || condition === "unknown";

    this._teardownRadar();
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="card">
          <section class="left">
            <div class="clock-row">
              <div class="clock-time" id="clock-time">${this._clockTime(now)}</div>
              <div class="clock-ampm" id="clock-ampm">${now.getHours() >= 12 ? "PM" : "AM"}</div>
            </div>
            <div class="clock-date" id="clock-date">${this._longDate(now)}</div>
            <div class="section-title">Hourly</div>
            <div class="hourly-left">${this._renderHourly(hourly)}</div>
          </section>
          <section class="center">
            <div class="current-row">
              <div class="wx-icon-lg">${this._icon(condition, 62)}</div>
              <div class="cond-block">
                <div class="cond-name">${unavailable ? "Connect weather in Home Assistant" : this._titleCase(condition)}</div>
                <div class="loc-name">${this._escape(locationName)}</div>
                <div class="updated-note">${unavailable ? "Waiting for live weather data" : `Updated ${this._shortTime(now)}`}</div>
              </div>
              <div class="temp-block">
                <div class="temp-now">${temp}°F</div>
                <div class="temp-hilo">${hiLo}</div>
              </div>
            </div>
            <div class="divider"></div>
            <div class="daily-strip">${this._renderDaily(mainPeriods)}</div>
            <div class="stats-row">
              ${this._stat("humidity", "Humidity", `${humidity}%`)}
              ${this._stat("wind", "Wind", wind)}
              ${this._stat("sunrise", "Sunrise", this._shortTime(sun.next_rising))}
              ${this._stat("sunset", "Sunset", this._shortTime(sun.next_setting))}
            </div>
          </section>
          ${this._config.show_radar === false ? "" : `
            <section class="right">
              <div id="rmap"></div>
              <div class="radar-lbl" id="radar-lbl">Radar loading...</div>
            </section>
          `}
        </div>
      </ha-card>
    `;

    if (this._config.show_radar !== false) {
      window.requestAnimationFrame(() => this._initRadar());
    }
    this._updateClock();
  }

  _updateClock() {
    const now = new Date();
    const time = this.shadowRoot?.getElementById("clock-time");
    const ampm = this.shadowRoot?.getElementById("clock-ampm");
    const date = this.shadowRoot?.getElementById("clock-date");
    if (time) time.textContent = this._clockTime(now);
    if (ampm) ampm.textContent = now.getHours() >= 12 ? "PM" : "AM";
    if (date) date.textContent = this._longDate(now);
  }

  _renderHourly(hours) {
    if (!hours.length) {
      return `<div class="loading-note">Waiting for hourly forecast.</div>`;
    }
    const slice = hours.slice(0, Number(this._config.hourly_count) || 8);
    const temps = slice.map((item) => this._num(item.temperature)).filter(Number.isFinite);
    const min = temps.length ? Math.min(...temps) : 60;
    const max = temps.length ? Math.max(...temps) : 90;
    const range = Math.max(max - min, 4);
    return slice.map((item) => {
      const temp = this._formatNumber(item.temperature);
      const pct = Number.isFinite(this._num(item.temperature))
        ? Math.max(12, Math.round(((this._num(item.temperature) - min) / range) * 80 + 12))
        : 12;
      return `
        <div class="hour-row">
          <div class="hour-time-left">${this._hour(item.datetime)}</div>
          <div class="hour-icon-left">${this._icon(item.condition || item.state, 23)}</div>
          <div class="hour-temp-left">${temp}°</div>
          <div class="hour-bar-wrap"><div class="hour-bar-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join("");
  }

  _renderDaily(periods) {
    if (!periods.length) {
      return `<div class="loading-note">Waiting for Home Assistant forecast data.</div>`;
    }
    return periods.slice(0, 5).map((item) => {
      const period = item.is_daytime === undefined ? "" : item.is_daytime ? "Day" : "Night";
      return `
        <div class="fc-slot">
          <div>
            <div class="fc-day">${this._dayName(item.datetime)}</div>
            <div class="fc-period">${period}</div>
          </div>
          <div class="fc-icon">${this._icon(item.condition || item.state, 48)}</div>
          <div class="fc-temp">${this._formatNumber(item.temperature)}°</div>
        </div>
      `;
    }).join("");
  }

  _stat(kind, label, value) {
    const icons = {
      humidity: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3s6 6.1 6 11a6 6 0 1 1-12 0c0-4.9 6-11 6-11Z" fill="#65b8df"/><path d="M9.2 16.4c.7 1.3 1.8 2 3.4 2" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
      wind: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 8h10.4a3 3 0 1 0-2.6-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 13h15.4a3 3 0 1 1-2.6 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
      sunrise: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 15a5 5 0 0 1 10 0" fill="#fbbf24"/><path d="M12 4v4M5 11l3 1M19 11l-3 1" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/></svg>`,
      sunset: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 15a5 5 0 0 1 10 0" fill="#f59e0b"/><path d="M12 8V4M5 11l3 1M19 11l-3 1" stroke="#7c3aed" stroke-width="2" stroke-linecap="round"/></svg>`
    };
    return `
      <div class="stat">
        <div class="stat-ico" aria-hidden="true">${icons[kind]}</div>
        <div><div class="stat-lbl">${label}</div><div class="stat-val">${this._escape(value || "--")}</div></div>
      </div>
    `;
  }

  async _initRadar() {
    const holder = this.shadowRoot?.getElementById("rmap");
    if (!holder || this._radarMap) return;
    await this._loadLeaflet();
    if (!window.L || !holder.isConnected) return;
    const lat = Number(this._config.latitude ?? this._hass?.config?.latitude ?? 0);
    const lon = Number(this._config.longitude ?? this._hass?.config?.longitude ?? 0);
    this._radarMap = window.L.map(holder, {
      center: [lat, lon],
      zoom: Number(this._config.radar_zoom) || 7,
      zoomControl: this._config.show_map_controls !== false,
      attributionControl: true
    });
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap &copy; CARTO"
    }).addTo(this._radarMap);
    window.L.circleMarker([lat, lon], {
      radius: 5,
      color: "#1a3a50",
      fillColor: "#1a3a50",
      fillOpacity: 1,
      weight: 2
    }).addTo(this._radarMap);
    window.setTimeout(() => this._radarMap?.invalidateSize(), 250);
    await this._loadRadarLoop();
    this._radarMap.on("moveend zoomend", () => {
      window.clearTimeout(this._radarReloadTimer);
      this._radarReloadTimer = window.setTimeout(() => this._loadRadarLoop(), 500);
    });
  }

  _teardownRadar() {
    window.clearInterval(this._radarTimer);
    window.clearTimeout(this._radarReloadTimer);
    this._radarLayers = [];
    this._radarIndex = 0;
    if (this._radarMap) {
      this._radarMap.remove();
      this._radarMap = null;
    }
  }

  async _loadLeaflet() {
    if (window.L) return;
    if (!document.querySelector("link[data-weather-wise-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.weatherWiseLeaflet = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector("script[data-weather-wise-leaflet]")) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.dataset.weatherWiseLeaflet = "true";
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
  }

  _radarFrames() {
    const stepMs = 5 * 60 * 1000;
    const roundedNow = Math.floor(Date.now() / stepMs) * stepMs;
    return Array.from({ length: 12 }, (_, i) => new Date(roundedNow - (11 - i) * stepMs));
  }

  _radarUrl(frameTime) {
    const bounds = this._radarMap.getBounds();
    const size = this._radarMap.getSize();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const service = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer";
    return `${service}/exportImage?bbox=${encodeURIComponent([sw.lng, sw.lat, ne.lng, ne.lat].join(","))}&bboxSR=4326&imageSR=4326&size=${Math.max(256, Math.round(size.x))},${Math.max(256, Math.round(size.y))}&format=png32&transparent=true&f=image&time=${frameTime.getTime()}&_=${Date.now()}`;
  }

  async _loadRadarLoop() {
    if (!this._radarMap || !window.L) return;
    window.clearInterval(this._radarTimer);
    this._radarLayers.forEach((item) => item.layer.remove());
    const frames = this._radarFrames();
    this._radarLayers = frames.map((frameTime, index) => {
      const layer = window.L.imageOverlay(this._radarUrl(frameTime), this._radarMap.getBounds(), {
        opacity: index === frames.length - 1 ? 0.78 : 0,
        zIndex: 20,
        interactive: false
      });
      layer.addTo(this._radarMap);
      return { layer, time: frameTime };
    });
    this._radarIndex = 0;
    const label = this.shadowRoot?.getElementById("radar-lbl");
    if (label) label.textContent = `${this._shortTime(frames.at(-1))} NOAA radar loop`;
    this._radarTimer = window.setInterval(() => {
      if (!this._radarLayers.length) return;
      this._radarLayers.forEach((item, index) => item.layer.setOpacity(index === this._radarIndex ? 0.78 : 0));
      const active = this._radarLayers[this._radarIndex];
      if (label && active) label.textContent = `${this._shortTime(active.time)} NOAA radar loop`;
      this._radarIndex = (this._radarIndex + 1) % this._radarLayers.length;
    }, 650);
  }

  _formatHiLo(daily, hourly) {
    let hi = this._num(daily?.[0]?.temperature);
    let lo = this._num(daily?.[0]?.templow ?? daily?.[0]?.low_temperature);
    if ((!Number.isFinite(hi) || !Number.isFinite(lo)) && hourly.length) {
      const next24 = hourly.slice(0, 24).map((item) => this._num(item.temperature)).filter(Number.isFinite);
      if (next24.length) {
        hi = Math.max(...next24);
        lo = Math.min(...next24);
      }
    }
    return `${this._formatNumber(hi)}°F / ${this._formatNumber(lo)}°F`;
  }

  _formatWind(attrs) {
    const speed = this._formatNumber(attrs.wind_speed);
    const bearing = Number(attrs.wind_bearing);
    const dir = Number.isFinite(bearing)
      ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8]
      : "";
    return `${dir ? `${dir} ` : ""}${speed} ${attrs.wind_speed_unit || "mph"}`;
  }

  _num(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  _formatNumber(value) {
    const number = this._num(value);
    return Number.isFinite(number) ? String(Math.round(number)) : "--";
  }

  _clockTime(date) {
    return `${(date.getHours() % 12) || 12}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  _shortTime(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return "--";
    return `${(date.getHours() % 12) || 12}:${String(date.getMinutes()).padStart(2, "0")} ${date.getHours() >= 12 ? "PM" : "AM"}`;
  }

  _hour(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return "--";
    return `${(date.getHours() % 12) || 12} ${date.getHours() >= 12 ? "PM" : "AM"}`;
  }

  _dayName(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return "--";
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  }

  _longDate(date) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  _titleCase(text) {
    const fixed = String(text || "--").replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
    const overrides = {
      partlycloudy: "Partly Cloudy",
      partly_cloudy: "Partly Cloudy",
      mostlycloudy: "Mostly Cloudy",
      clear_night: "Clear Night"
    };
    const key = String(text || "").toLowerCase();
    return overrides[key] || fixed.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  _escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  _icon(condition, size = 36) {
    const c = String(condition || "").toLowerCase().replace(/[-_]/g, " ");
    if (c.includes("lightning") || c.includes("thunder")) return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><ellipse cx="22" cy="15" rx="11" ry="8" fill="#94a3b8"/><ellipse cx="14" cy="18" rx="9" ry="6" fill="#cbd5e1"/><polygon points="22,22 16,34 21,31 17,41 28,27 22,30" fill="#fbbf24"/><line x1="14" y1="28" x2="12" y2="34" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/><line x1="27" y1="28" x2="25" y2="34" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/></svg>`;
    if (c.includes("rain") || c.includes("shower") || c.includes("drizzle")) return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><ellipse cx="22" cy="14" rx="11" ry="8" fill="#94a3b8"/><ellipse cx="14" cy="17" rx="9" ry="6" fill="#cbd5e1"/><line x1="14" y1="26" x2="12" y2="33" stroke="#38bdf8" stroke-width="2.3" stroke-linecap="round"/><line x1="20" y1="26" x2="18" y2="33" stroke="#38bdf8" stroke-width="2.3" stroke-linecap="round"/><line x1="26" y1="26" x2="24" y2="33" stroke="#38bdf8" stroke-width="2.3" stroke-linecap="round"/></svg>`;
    if (c.includes("snow") || c.includes("sleet") || c.includes("hail")) return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><ellipse cx="22" cy="14" rx="11" ry="8" fill="#94a3b8"/><ellipse cx="14" cy="17" rx="9" ry="6" fill="#cbd5e1"/><text x="10" y="34" font-size="13" fill="#93c5fd">*</text><text x="23" y="34" font-size="13" fill="#93c5fd">*</text></svg>`;
    if (c.includes("sunny") || c.includes("clear")) {
      if (c.includes("night")) return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><circle cx="23" cy="20" r="10" fill="#fbbf24"/><path d="M23 9Q11 14 15 29Q8 23 8 17Q8 7 19 5Q15 11 23 9Z" fill="#1e3a5f"/></svg>`;
      return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><circle cx="20" cy="20" r="8.5" fill="#fbbf24"/><g stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"><line x1="20" y1="4" x2="20" y2="8"/><line x1="20" y1="32" x2="20" y2="36"/><line x1="4" y1="20" x2="8" y2="20"/><line x1="32" y1="20" x2="36" y2="20"/><line x1="8.7" y1="8.7" x2="11.5" y2="11.5"/><line x1="28.5" y1="28.5" x2="31.3" y2="31.3"/><line x1="31.3" y1="8.7" x2="28.5" y2="11.5"/><line x1="11.5" y1="28.5" x2="8.7" y2="31.3"/></g></svg>`;
    }
    if (c.includes("partly") || c.includes("mostly cloudy") || c.includes("mostlycloudy")) return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><circle cx="14" cy="19" r="7" fill="#fbbf24"/><ellipse cx="26" cy="22" rx="11" ry="8" fill="#94a3b8"/><ellipse cx="18" cy="25" rx="9" ry="7" fill="#cbd5e1"/></svg>`;
    if (c.includes("fog") || c.includes("mist")) return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><line x1="8" y1="16" x2="32" y2="16" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/><line x1="6" y1="22" x2="34" y2="22" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/><line x1="10" y1="28" x2="30" y2="28" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/></svg>`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><ellipse cx="23" cy="17" rx="12" ry="9" fill="#94a3b8"/><ellipse cx="14" cy="21" rx="9" ry="7" fill="#cbd5e1"/></svg>`;
  }

  _styles() {
    return `
      :host{display:block;color:#0a1e2e}
      ha-card{overflow:hidden;background:transparent;box-shadow:none}
      *{box-sizing:border-box}
      .card{display:grid;grid-template-columns:minmax(320px,24%) minmax(620px,1fr) minmax(500px,33%);min-height:620px;background:linear-gradient(135deg,rgba(255,255,255,0.30),rgba(255,255,255,0.08) 42%,rgba(73,180,196,0.10)),rgba(236,248,251,0.80);border:1px solid rgba(255,255,255,0.42);border-radius:18px;box-shadow:0 8px 34px rgba(9,35,49,0.14);overflow:hidden;font-family:var(--ha-font-family-body,-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,Arial,sans-serif)}
      .left{min-width:0;display:flex;flex-direction:column;padding:14px 22px 12px;background:linear-gradient(90deg,rgba(255,255,255,0.20),rgba(255,255,255,0.08));border-right:1px solid rgba(255,255,255,0.22)}
      .clock-row{display:flex;align-items:baseline;gap:8px;line-height:1}
      .clock-time{font-size:68px;font-weight:560;color:#0a1e2e;letter-spacing:0}
      .clock-ampm{font-size:20px;font-weight:750;color:#244a63}
      .clock-date{font-size:15px;color:#2a5070;font-weight:750;margin-top:8px;margin-bottom:13px}
      .section-title{font-size:11px;text-transform:uppercase;letter-spacing:.075em;color:#4a7a90;font-weight:800;margin:4px 0 7px}
      .hourly-left{display:flex;flex-direction:column;gap:9px}
      .hour-row{display:grid;grid-template-columns:48px 24px 38px 1fr;align-items:center;gap:8px;min-height:30px;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,0.18)}
      .hour-time-left{font-size:12px;color:#17364d;font-weight:750;text-transform:uppercase}
      .hour-icon-left{width:23px;height:23px;display:flex;align-items:center;justify-content:center}
      .hour-temp-left{font-size:13px;font-weight:750;color:#0a1e2e;text-align:right}
      .hour-bar-wrap{height:7px;border-radius:999px;background:rgba(18,59,83,0.10);position:relative;overflow:hidden}
      .hour-bar-fill{position:absolute;top:0;left:0;height:100%;border-radius:999px;background:linear-gradient(90deg,#58b7c7,#1f7f96)}
      .center{min-width:0;display:flex;flex-direction:column;padding:18px 24px;border-right:1px solid rgba(255,255,255,0.22);overflow:hidden}
      .current-row{display:flex;align-items:center;gap:16px;margin-bottom:10px}
      .wx-icon-lg{width:68px;height:68px;flex-shrink:0;display:grid;place-items:center;border-radius:17px;background:rgba(255,255,255,0.34);border:1px solid rgba(255,255,255,0.45)}
      .cond-block{flex:1;min-width:0}
      .cond-name{font-size:28px;font-weight:780;color:#0a1e2e;line-height:1.05}
      .loc-name{font-size:15px;color:#2a5070;font-weight:700;margin-top:5px}
      .updated-note{font-size:11px;color:#5f8799;font-weight:750;margin-top:5px;text-transform:uppercase;letter-spacing:.04em}
      .temp-block{text-align:right;flex-shrink:0}
      .temp-now{font-size:52px;font-weight:780;color:#0a1e2e;line-height:1;letter-spacing:0}
      .temp-hilo{font-size:16px;color:#4a7a90;font-weight:700;margin-top:8px}
      .divider{height:1px;background:linear-gradient(90deg,transparent,rgba(42,100,130,0.22),transparent);margin:0 0 10px}
      .daily-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;min-height:140px;max-height:166px;margin-bottom:8px;flex:1}
      .fc-slot{display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:8px 6px;background:rgba(255,255,255,0.34);border-radius:8px;border:1px solid rgba(255,255,255,0.38);min-width:0}
      .fc-day{font-size:16px;font-weight:720;color:#0a1e2e;text-transform:uppercase;line-height:1.05;text-align:center}
      .fc-period{font-size:11px;font-weight:800;color:#3b6d82;text-transform:uppercase;letter-spacing:.045em;margin-top:2px;min-height:13px;line-height:1.05;text-align:center}
      .fc-icon{width:50px;height:50px;margin:2px 0 1px;display:flex;align-items:center;justify-content:center}
      .fc-icon svg{width:46px;height:46px}
      .fc-temp{font-size:34px;font-weight:700;color:#0a1e2e;letter-spacing:0;line-height:.95}
      .stats-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:5px;flex-shrink:0}
      .stat{background:rgba(255,255,255,0.32);border:1px solid rgba(255,255,255,0.42);border-radius:8px;padding:7px 10px;display:flex;align-items:center;gap:9px;min-height:50px;min-width:0}
      .stat-ico{width:21px;height:21px;flex:0 0 21px;color:#2a7892}
      .stat-ico svg{width:21px;height:21px}
      .stat-lbl{font-size:9px;color:#4a7a90;font-weight:800;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
      .stat-val{font-size:14px;font-weight:800;color:#0a1e2e;white-space:nowrap}
      .right{min-width:0;position:relative;overflow:hidden;border-radius:0 18px 18px 0}
      #rmap{width:100%;height:100%;min-height:620px}
      .radar-lbl{position:absolute;bottom:10px;left:12px;font-size:12px;color:rgba(10,30,46,0.76);background:rgba(255,255,255,0.78);border:1px solid rgba(255,255,255,0.55);padding:4px 10px;border-radius:99px;font-weight:800;z-index:1000;pointer-events:none}
      .leaflet-control-zoom{border:0!important;box-shadow:0 2px 12px rgba(10,30,46,.13)!important}
      .leaflet-control-zoom a{width:34px!important;height:34px!important;line-height:31px!important;color:#0a1e2e!important;background:rgba(255,255,255,.82)!important;border-color:rgba(10,30,46,.10)!important;font-weight:650!important}
      .leaflet-control-attribution{background:rgba(255,255,255,.70)!important;color:rgba(10,30,46,.72)!important}
      .loading-note{font-size:12px;color:#4a7a90;font-weight:800;opacity:.8;padding:10px}
      .daily-strip>.loading-note{grid-column:1 / -1;align-self:center}
      @media(max-width:1500px){.card{grid-template-columns:minmax(300px,24%) minmax(560px,1fr) minmax(430px,32%)}.left{padding:13px 18px 11px}.center{padding:16px 20px}.clock-time{font-size:60px}.temp-now{font-size:46px}.cond-name{font-size:25px}.daily-strip{min-height:130px;max-height:150px}.hour-row{grid-template-columns:44px 22px 34px 1fr;gap:6px}.stat{padding:6px 8px;gap:7px}}
      @media(max-width:1350px){.card{grid-template-columns:minmax(300px,36%) minmax(0,1fr);grid-template-rows:auto minmax(330px,42vh);min-height:0}.center{border-right:0}.right{grid-column:1 / -1;min-height:330px;border-top:1px solid rgba(255,255,255,0.28);border-radius:0 0 18px 18px}#rmap{min-height:330px}}
      @media(max-width:760px){.card{display:flex;flex-direction:column}.left,.center{border-right:0}.clock-time{font-size:48px}.current-row{align-items:flex-start;gap:12px;flex-wrap:wrap}.temp-block{text-align:left}.daily-strip{grid-template-columns:repeat(3,minmax(0,1fr));max-height:none}.stats-row{grid-template-columns:repeat(2,minmax(0,1fr))}.right,#rmap{min-height:300px}}
    `;
  }
}

class WeatherWiseCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this.render();
  }

  render() {
    const config = this._config || {};
    this.innerHTML = `
      <style>
        .field{display:block;margin:12px 0}
        label{display:block;font-weight:600;margin-bottom:4px}
        input{width:100%;box-sizing:border-box;padding:8px}
      </style>
      <div class="field"><label>Weather entity</label><input data-key="entity" value="${config.entity || ""}" placeholder="weather.home"></div>
      <div class="field"><label>Name</label><input data-key="name" value="${config.name || ""}" placeholder="Home"></div>
      <div class="field"><label>Latitude</label><input data-key="latitude" value="${config.latitude || ""}" placeholder="33.688"></div>
      <div class="field"><label>Longitude</label><input data-key="longitude" value="${config.longitude || ""}" placeholder="-78.886"></div>
    `;
    this.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.key;
        const value = ["latitude", "longitude"].includes(key) ? Number(input.value) : input.value;
        this._config = { ...this._config, [key]: value };
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: this._config },
          bubbles: true,
          composed: true
        }));
      });
    });
  }
}

customElements.define("weather-wise-card", WeatherWiseCard);
customElements.define("weather-wise-card-editor", WeatherWiseCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "weather-wise-card",
  name: "Weather Wise",
  description: "A polished weather dashboard card with forecast, conditions, and NOAA radar."
});
