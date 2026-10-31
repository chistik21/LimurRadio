/* ==========================================================
   Limurane — Погода (Liquid Glass, в духе Apple Weather)
   Данные: Open-Meteo (без ключа). Иконки и фоны — из сети.
   Раздел «Погода» в сайдбаре + виджет-карточка на главной.
   ========================================================== */
(function () {
  "use strict";

  /* Самостоятельная страница (weather.html) не грузит плеер: там своего state нет,
     а общий store всё равно нужен — погода симметрична для обоих хостов. */
  const ownState = typeof state !== "undefined";
  if (!ownState) window.state = { view: "weather", weather: null, unit: "C" };

  /* Оба хоста (плеер и отдельная страница) читают стор единообразно.
     На странице плеера это те же объекты, что и глобальные. */
  const S = window.state;

  const LS_W = "limurane.weather.v2";
  const DEFAULT_CITY = { name: "Шумерля", admin: "Чувашия", lat: 55.5005, lon: 46.41288 };

  const stored = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_W) || "null");
      return raw && raw.city ? raw : null;
    } catch (e) {
      return null;
    }
  })();

  S.weather = {
    city: (stored && stored.city) || DEFAULT_CITY,
    data: (stored && stored.data) || null,
    loading: false,
    error: "",
    unit: (stored && stored.unit) || "C",
  };

  /* ================= Справочники ================= */

  const CODES = {
    0: ["Ясно", "clear"],
    1: ["Преимущественно ясно", "mostly-clear"],
    2: ["Переменная облачность", "partly"],
    3: ["Пасмурно", "cloudy"],
    45: ["Туман", "fog"],
    48: ["Изморозь", "fog"],
    51: ["Слабая морось", "drizzle"],
    53: ["Морось", "drizzle"],
    55: ["Сильная морось", "drizzle"],
    56: ["Ледяная морось", "drizzle"],
    57: ["Сильная ледяная морось", "drizzle"],
    61: ["Слабый дождь", "rain"],
    63: ["Дождь", "rain"],
    65: ["Сильный дождь", "rain"],
    66: ["Ледяной дождь", "rain"],
    67: ["Сильный ледяной дождь", "rain"],
    71: ["Слабый снег", "snow"],
    73: ["Снег", "snow"],
    75: ["Сильный снег", "snow"],
    77: ["Снежная крупа", "snow"],
    80: ["Слабый ливень", "rain"],
    81: ["Ливень", "rain"],
    82: ["Сильный ливень", "rain"],
    85: ["Снегопад", "snow"],
    86: ["Сильный снегопад", "snow"],
    95: ["Гроза", "thunder"],
    96: ["Гроза с градом", "thunder"],
    99: ["Сильная гроза с градом", "thunder"],
  };

  const GROUPS = {
    clear: "clear",
    "mostly-clear": "clear",
    partly: "partly",
    cloudy: "cloudy",
    fog: "fog",
    drizzle: "rain",
    rain: "rain",
    snow: "snow",
    thunder: "thunder",
  };

  /* Фоновые фотографии (Unsplash) на каждый тип погоды и время суток */
  const PHOTOS = {
    "day-clear": "https://images.pexels.com/photos/96622/pexels-photo-96622.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "day-partly": "https://images.pexels.com/photos/531767/pexels-photo-531767.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "day-cloudy": "https://images.pexels.com/photos/209831/pexels-photo-209831.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "day-rain": "https://images.pexels.com/photos/166360/pexels-photo-166360.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "day-snow": "https://images.pexels.com/photos/1366919/pexels-photo-1366919.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "day-fog": "https://images.pexels.com/photos/325185/pexels-photo-325185.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "day-thunder": "https://images.pexels.com/photos/1118873/pexels-photo-1118873.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "night-clear": "https://images.pexels.com/photos/1895244/pexels-photo-1895244.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "night-partly": "https://images.pexels.com/photos/460672/pexels-photo-460672.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "night-cloudy": "https://images.pexels.com/photos/1399872/pexels-photo-1399872.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "night-rain": "https://images.pexels.com/photos/1435510/pexels-photo-1435510.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "night-snow": "https://images.pexels.com/photos/907110/pexels-photo-907110.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "night-fog": "https://images.pexels.com/photos/1399872/pexels-photo-1399872.jpeg?auto=compress&cs=tinysrgb&w=1600",
    "night-thunder": "https://images.pexels.com/photos/1162251/pexels-photo-1162251.jpeg?auto=compress&cs=tinysrgb&w=1600",
  };

  /* Иконки Apple Weather (OpenWeatherMap) */
  function iconUrl(code, isDay) {
    const map = {
      0: isDay ? "01d" : "01n",
      1: isDay ? "02d" : "02n",
      2: isDay ? "03d" : "03n",
      3: isDay ? "04d" : "04n",
      45: "50d",
      48: "50d",
      51: "09d",
      53: "09d",
      55: "09d",
      56: "09d",
      57: "09d",
      61: "10d",
      63: "10d",
      65: "10d",
      66: "13d",
      67: "13d",
      71: "13d",
      73: "13d",
      75: "13d",
      77: "13d",
      80: "09d",
      81: "09d",
      82: "09d",
      85: "13d",
      86: "13d",
      95: "11d",
      96: "11d",
      99: "11d",
    };
    const base = map[code] || (isDay ? "01d" : "01n");
    const v = base.endsWith("n") ? "10n" : "10d";
    return `https://openweathermap.org/img/wn/${v}@2x.png`;
  }

  const DAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const DAYS_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  function info(code) {
    return CODES[code] || ["—", "cloudy"];
  }

  function groupOf(code) {
    return GROUPS[info(code)[1]] || "cloudy";
  }

  function photoFor(code, isDay) {
    const g = groupOf(code);
    return PHOTOS[`${isDay ? "day" : "night"}-${g}`] || PHOTOS[isDay ? "day-clear" : "night-clear"];
  }

  function convert(t, unit) {
    if (t == null) return "—";
    const v = unit === "F" ? t * 1.8 + 32 : t;
    return Math.round(v);
  }

  const unitSign = () => (S.weather.unit === "F" ? "°F" : "°C");
  const tempText = (t) => `${convert(t, S.weather.unit)}°`;

  function windDir(deg) {
    const dirs = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
    return dirs[Math.round(deg / 45) % 8];
  }

  function dewPoint(t, rh, unit) {
    const c = unit === "F" ? (t - 32) / 1.8 : t;
    const a = 17.27;
    const b = 237.7;
    const g = (a * c) / (b + c) + Math.log(Math.max(1, rh) / 100);
    const d = (b * g) / (a - g);
    return Math.round(unit === "F" ? d * 1.8 + 32 : d);
  }

  function cloudText(v) {
    if (v < 20) return "почти чисто";
    if (v < 50) return "рассеянная облачность";
    if (v < 85) return "облачно с прояснениями";
    return "сплошная облачность";
  }

  function isDayHour(iso, d) {
    const day = d.days.find((x) => x.date === iso.slice(0, 10));
    if (!day) return true;
    const t = iso.slice(11, 16);
    return t >= day.sunrise.slice(11, 16) && t < day.sunset.slice(11, 16);
  }

  function hhmm(iso) {
    return iso ? iso.slice(11, 16) : "—";
  }

  function clockNow(tz) {
    try {
      return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined }).format(new Date());
    } catch (e) {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }

  /* ================= API ================= */

  async function geocode(city) {
    const own = String(city).trim();
    if (!own) throw new Error("Введите город");
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(own)}&count=1&language=ru&format=json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Геокодер недоступен");
    const j = await r.json();
    const hit = j.results && j.results[0];
    if (!hit) throw new Error(`Город «${own}» не найден`);
    return { name: hit.name, admin: hit.admin1 || hit.country || "", lat: hit.latitude, lon: hit.longitude };
  }

  async function fetchWeather(city) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code," +
      "cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m" +
      "&hourly=temperature_2m,weather_code,precipitation_probability" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max" +
      "&timezone=auto&forecast_days=10";
    const r = await fetch(url);
    if (!r.ok) throw new Error("Метеосервис недоступен");
    const j = await r.json();

    /* Почасовой ряд — начиная с текущего часа */
    const start = Math.max(0, j.hourly.time.findIndex((t) => t >= j.current.time.slice(0, 13) + ":00"));
    const nowIdx = start < 0 ? 0 : start;
    const hours = [];
    for (let i = nowIdx; i < Math.min(nowIdx + 25, j.hourly.time.length); i++) {
      hours.push({
        time: j.hourly.time[i],
        temp: j.hourly.temperature_2m[i],
        code: j.hourly.weather_code[i],
        pop: j.hourly.precipitation_probability[i],
      });
    }

    const days = j.daily.time.map((d, i) => ({
      date: d,
      code: j.daily.weather_code[i],
      max: j.daily.temperature_2m_max[i],
      min: j.daily.temperature_2m_min[i],
      sunrise: j.daily.sunrise[i],
      sunset: j.daily.sunset[i],
      uv: j.daily.uv_index_max[i],
      pop: j.daily.precipitation_probability_max[i],
    }));

    return {
      at: Date.now(),
      tz: j.timezone,
      current: j.current,
      hours,
      days,
    };
  }

  function save() {
    try {
      localStorage.setItem(LS_W, JSON.stringify({ city: S.weather.city, data: S.weather.data, unit: S.weather.unit }));
    } catch (e) {
      /* квота — не критично */
    }
  }

  /* Перерисовать только текущий экран — без сброса в раздел «Главная».
     На радио `render()` рисует библиотеку, поэтому зовём его лишь вне радио. */
  function repaint() {
    if (ownState && typeof render === "function") render();
    if (ownState && typeof refreshSidebar === "function") refreshSidebar();
  }

  function repaintWeather() {
    if (S.view === "weather" && window.viewEl) page();
  }

  async function load(city) {
    const w = S.weather;
    w.loading = true;
    w.error = "";
    if (S.view === "weather") repaintWeather();
    else repaint();
    try {
      const data = await fetchWeather(city || w.city);
      w.data = data;
      save();
    } catch (e) {
      w.error = e.message || "Не удалось загрузить погоду";
    }
    w.loading = false;
    if (S.view === "weather") repaintWeather();
    else repaint();
    window.dispatchEvent(new CustomEvent("weather:update"));
  }

  async function setCity(name) {
    S.weather.loading = true;
    S.weather.error = "";
    if (S.view === "weather") repaintWeather();
    else repaint();
    try {
      const city = await geocode(name);
      S.weather.city = city;
      S.weather.data = null;
      await load(city);
    } catch (e) {
      S.weather.error = e.message;
      S.weather.loading = false;
      notice(e.message);
      if (S.view === "weather") repaintWeather();
      else repaint();
    }
  }

  function toggleUnit() {
    S.weather.unit = S.weather.unit === "C" ? "F" : "C";
    save();
    if (S.view === "weather") repaintWeather();
    else repaint();
  }

  function refresh() {
    return load(S.weather.city);
  }

  /* На отдельной странице ошибки некуда вывести тостами — показываем их в ленте */
  function notice(text) {
    const root = document.getElementById("toastRoot");
    if (!root) return;
    const t = node("div", "wx-toast", text);
    root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /* ================= UI: утилиты ================= */

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function tempNode(t) {
    const s = tempText(t);
    const parts = s.match(/^(-?\d+)(°.*)$/) || [s, s, ""];
    const n = node("span");
    n.appendChild(node("span", "wx-num", parts[1]));
    n.appendChild(node("span", "wx-deg", parts[2] || ""));
    return n;
  }

  function iconImg(code, isDay, cls) {
    const img = document.createElement("img");
    img.className = cls || "wx-icon";
    img.src = iconUrl(code, isDay);
    img.alt = info(code)[0];
    img.loading = "lazy";
    img.draggable = false;
    return img;
  }

  function glass(cls) {
    const n = node("div", "glass" + (cls ? " " + cls : ""));
    return n;
  }

  /* Подписи под крупным значком героя: AQI у Apple есть, у Open-Meteo нет —
     показываем «Ощущается как» и УФ-индекс. */
  function heroChips() {
    const w = S.weather;
    const c = w.data.current;
    const day = w.data.days[0];
    const uv = day.uv ?? 0;
    const box = node("div", "wx-chips");
    const a = node("div", "wx-chip");
    a.appendChild(node("span", "wx-chip-label", "Ощущается как"));
    a.appendChild(node("span", "wx-chip-value", `${convert(c.apparent_temperature, w.unit)}°`));
    box.appendChild(a);
    const b = node("div", "wx-chip");
    b.appendChild(node("span", "wx-chip-label", "УФ-индекс"));
    b.appendChild(node("span", "wx-chip-value", `${Math.round(uv)} · ${uv >= 3 ? "высокий" : uv >= 1 ? "низкий" : "минимальный"}`));
    box.appendChild(b);
    return box;
  }

  function bgUrl() {
    const w = S.weather;
    if (!w.data) {
      const h = new Date().getHours();
      return PHOTOS[h >= 7 && h < 18 ? "day-partly" : "night-partly"];
    }
    return photoFor(w.data.current.weather_code, w.data.current.is_day === 1);
  }

  /* ================= UI: виджет на главной ================= */

  function widget() {
    const w = S.weather;
    const d = w.data;
    const card = node("div", "wxw");
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute("aria-label", "Открыть погоду");
    const open = () => window.navigate && window.navigate("weather");
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    const bg = node("div", "wxw-bg");
    if (d) bg.style.backgroundImage = `url("${photoFor(d.current.weather_code, d.current.is_day === 1)}")`;
    card.appendChild(bg);
    card.appendChild(node("div", "wxw-veil"));

    const body = node("div", "wxw-body");
    body.appendChild(node("div", "wxw-city", `Погода · ${w.city.name}`));
    if (!d) {
      body.appendChild(node("div", "wxw-temp wx-num", w.loading ? "…" : "—"));
      body.appendChild(node("div", "wxw-desc", w.error || "Выберите раздел, чтобы посмотреть прогноз"));
      card.appendChild(body);
      return card;
    }
    const c = d.current;
    const line = node("div", "wxw-line");
    line.appendChild(iconImg(c.weather_code, c.is_day === 1, "wxw-icon"));
    const t = tempNode(c.temperature_2m);
    t.className = "wxw-temp";
    line.appendChild(t);
    body.appendChild(line);
    body.appendChild(node("div", "wxw-desc", info(c.weather_code)[0]));
    const meta = node("div", "wxw-meta");
    meta.appendChild(node("span", null, `↑${convert(d.days[0].max, w.unit)}°  ↓${convert(d.days[0].min, w.unit)}°`));
    meta.appendChild(node("span", "wxw-dot", "·"));
    meta.appendChild(node("span", null, `${clockNow(d.tz)} местное`));
    body.appendChild(meta);

    /* мини-полоса часов */
    const strip = node("div", "wxw-hours");
    const base = d.hours[0] ? d.hours[0].temp : 0;
    d.hours.slice(1, 6).forEach((h) => {
      const cell = node("div", "wxw-hour");
      cell.appendChild(node("span", null, h.time.slice(11, 16)));
      cell.appendChild(iconImg(h.code, isDayHour(h.time, d), "wxw-hicon"));
      cell.appendChild(node("span", "wxw-htemp", `${convert(h.temp, w.unit)}°`));
      const bar = node("span", "wxw-bar");
      const k = Math.max(0.12, Math.min(1, 0.5 + (h.temp - base) / 12));
      bar.style.height = `${20 + k * 22}px`;
      cell.appendChild(bar);
      strip.appendChild(cell);
    });
    body.appendChild(strip);
    card.appendChild(body);
    return card;
  }

  /* ================= UI: страница погоды ================= */

  function heroCard() {
    const w = S.weather;
    const d = w.data;
    const card = glass("wx-hero");
    if (d) card.style.backgroundImage = `url("${bgUrl()}")`;
    card.appendChild(node("div", "wx-hero-veil"));

    const top = node("div", "wx-hero-top");
    const cityBtn = node("button", "wx-city-btn");
    cityBtn.type = "button";
    cityBtn.setAttribute("aria-label", "Сменить город");
    cityBtn.innerHTML = `<span class="wx-city-name">${w.city.name}</span><span class="wx-pin" aria-hidden="true"></span>`;
    cityBtn.addEventListener("click", () => openCityDialog());
    top.appendChild(cityBtn);
    const unitBtn = node("button", "wx-unit", w.unit === "C" ? "°C" : "°F");
    unitBtn.type = "button";
    unitBtn.setAttribute("aria-label", "Переключить единицы");
    unitBtn.addEventListener("click", toggleUnit);
    top.appendChild(unitBtn);
    card.appendChild(top);

    if (!d) {
      const wait = node("div", "wx-wait", w.loading ? "Обновляем данные…" : w.error || "Данных пока нет");
      card.appendChild(wait);
      return card;
    }

    const c = d.current;
    const main = node("div", "wx-main");
    main.appendChild(node("div", "wx-temp-big", `${convert(c.temperature_2m, w.unit)}°`));
    main.appendChild(node("div", "wx-desc-big", info(c.weather_code)[0]));
    main.appendChild(node("div", "wx-range", `Макс.: ${convert(d.days[0].max, w.unit)}°  Мин.: ${convert(d.days[0].min, w.unit)}°`));
    card.appendChild(main);

    const row = node("div", "wx-hero-row");
    const nowD = new Date();
    row.appendChild(node("div", "wx-hero-time", `${clockNow(d.tz)} местное`));
    row.appendChild(node("div", "wx-hero-date", `${DAYS_FULL[nowD.getDay()]}, ${nowD.getDate()} ${MONTHS[nowD.getMonth()]}`));
    card.appendChild(row);

    const iconWrap = node("div", "wx-hero-icon");
    iconWrap.appendChild(iconImg(c.weather_code, c.is_day === 1, "wx-big-icon"));
    iconWrap.appendChild(heroChips());
    card.appendChild(iconWrap);
    return card;
  }

  function hourlyCard() {
    const w = S.weather;
    const d = w.data;
    const card = glass("wx-panel");
    const head = node("div", "wx-panel-head");
    head.appendChild(node("span", "wx-panel-label", "Почасовой прогноз"));
    card.appendChild(head);
    const row = node("div", "wx-scroll wx-hours-row");
    d.hours.forEach((h, i) => {
      const cell = node("div", "wx-hour" + (i === 0 ? " now" : ""));
      cell.appendChild(node("span", "wx-hour-time", i === 0 ? "Сейчас" : h.time.slice(11, 16)));
      cell.appendChild(iconImg(h.code, isDayHour(h.time, d), "wx-hour-icon"));
      if (h.pop >= 5) cell.appendChild(node("span", "wx-pop", `${h.pop}%`));
      cell.appendChild(node("span", "wx-hour-temp", `${convert(h.temp, w.unit)}°`));
      row.appendChild(cell);
    });
    card.appendChild(row);
    return card;
  }

  function dailyCard() {
    const w = S.weather;
    const d = w.data;
    const card = glass("wx-panel");
    const head = node("div", "wx-panel-head");
    head.appendChild(node("span", "wx-panel-label", "Прогноз на 10 дней"));
    card.appendChild(head);

    const all = d.days.map((x) => x.max).concat(d.days.map((x) => x.min));
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = Math.max(1, hi - lo);

    const list = node("div", "wx-days");
    d.days.forEach((x, i) => {
      const row = node("div", "wx-day");
      const name = i === 0 ? "Сегодня" : DAYS[new Date(x.date + "T12:00:00").getDay()];
      row.appendChild(node("span", "wx-day-name", name));
      row.appendChild(iconImg(x.code, true, "wx-day-icon"));
      row.appendChild(node("span", "wx-day-min", `${convert(x.min, w.unit)}°`));
      const track = node("span", "wx-day-track");
      const fill = node("span", "wx-day-fill");
      fill.style.left = `${((x.min - lo) / span) * 100}%`;
      fill.style.width = `${Math.max(8, ((x.max - x.min) / span) * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(node("span", "wx-day-max", `${convert(x.max, w.unit)}°`));
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  function statCell(label, value, sub) {
    const cell = node("div", "wx-stat");
    cell.appendChild(node("span", "wx-stat-label", label));
    cell.appendChild(node("span", "wx-stat-value", value));
    if (sub) cell.appendChild(node("span", "wx-stat-sub", sub));
    return cell;
  }

  function detailsCard() {
    const w = S.weather;
    const c = w.data.current;
    const day = w.data.days[0];
    const unit = unitSign();
    const uv = Math.round(day.uv ?? 0);
    const card = glass("wx-panel wx-details");
    const head = node("div", "wx-panel-head");
    head.appendChild(node("span", "wx-panel-label", "Подробно"));
    card.appendChild(head);

    const grid = node("div", "wx-stats");
    grid.appendChild(statCell("Ощущается", `${convert(c.apparent_temperature, w.unit)}${unit}`, "температура по ветру"));
    grid.appendChild(statCell("Влажность", `${Math.round(c.relative_humidity_2m)}%`, `точка росы ${dewPoint(c.temperature_2m, c.relative_humidity_2m, w.unit)}${unit}`));
    grid.appendChild(statCell("Ветер", `${Math.round(c.wind_speed_10m)} км/ч`, `${windDir(c.wind_direction_10m)}, ${Math.round(c.wind_direction_10m)}°`));
    grid.appendChild(statCell("Осадки", `${(c.precipitation ?? 0).toFixed(1)} мм`, `вероятность ${day.pop ?? 0}%`));
    grid.appendChild(statCell("Облачность", `${Math.round(c.cloud_cover)}%`, cloudText(c.cloud_cover)));
    grid.appendChild(statCell("Давление", `${Math.round(c.pressure_msl)} гПа`, `${Math.round(c.pressure_msl * 0.75006)} мм рт. ст.`));
    grid.appendChild(statCell("УФ-индекс", `${uv}`, uv >= 6 ? "высокий, защита нужна" : uv >= 3 ? "умеренный" : "низкий"));
    grid.appendChild(statCell("Восход", hhmm(day.sunrise), `Закат ${hhmm(day.sunset)}`));
    card.appendChild(grid);
    return card;
  }

  function page() {
    const viewEl = window.viewEl || document.getElementById("view");
    if (!viewEl) return;
    viewEl.replaceChildren();
    const wrap = node("div", "wx-page");
    wrap.style.setProperty("--wx-bg", `url("${bgUrl()}")`);

    const w = S.weather;
    const bar = node("div", "wx-toolbar");
    const title = node("div", "wx-title-wrap");
    title.appendChild(node("h1", "wx-title", "Погода"));
    title.appendChild(node("div", "wx-subtitle", `${w.city.name}${w.city.admin ? `, ${w.city.admin}` : ""}`));
    bar.appendChild(title);

    const actions = node("div", "wx-actions");
    const cityBtn = node("button", "wx-pill");
    cityBtn.innerHTML = `<span class="wx-pin" aria-hidden="true"></span>Сменить город`;
    cityBtn.addEventListener("click", () => openCityDialog());
    actions.appendChild(cityBtn);

    const refBtn = node("button", "wx-pill");
    refBtn.innerHTML = `<span class="wx-refresh${w.loading ? " spin" : ""}" aria-hidden="true"></span>Обновить`;
    refBtn.addEventListener("click", () => refresh());
    actions.appendChild(refBtn);
    bar.appendChild(actions);
    wrap.appendChild(bar);

    if (w.error) wrap.appendChild(node("div", "wx-error", w.error));

    wrap.appendChild(heroCard());
    if (w.data) {
      wrap.appendChild(hourlyCard());
      wrap.appendChild(dailyCard());
      wrap.appendChild(detailsCard());
      const src = node("div", "wx-source", "Данные: Open-Meteo · фоны и иконки загружаются из сети");
      wrap.appendChild(src);
    }

    viewEl.appendChild(wrap);
  }

  /* ================= Диалог смены города ================= */

  function openCityDialog() {
    document.querySelectorAll(".wx-modal").forEach((n) => n.remove());
    const back = node("div", "wx-modal");
    const box = node("div", "wx-modal-box");
    box.appendChild(node("h2", "wx-modal-title", "Город"));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "wx-modal-input";
    input.placeholder = "Например, Шумерля или Чебоксары";
    input.autocomplete = "off";
    box.appendChild(input);

    const hint = node("div", "wx-modal-hint", "Погода появится сразу после выбора");
    box.appendChild(hint);

    const btns = node("div", "wx-modal-actions");
    const cancel = node("button", "wx-modal-cancel", "Отмена");
    const ok = node("button", "wx-modal-ok", "Показать");
    btns.appendChild(cancel);
    btns.appendChild(ok);
    box.appendChild(btns);
    back.appendChild(box);
    document.body.appendChild(back);
    setTimeout(() => input.focus(), 30);

    const close = () => back.remove();
    cancel.addEventListener("click", close);
    back.addEventListener("click", (e) => {
      if (e.target === back) close();
    });
    const submit = () => {
      const v = input.value.trim();
      if (!v) {
        input.focus();
        return;
      }
      close();
      setCity(v);
    };
    ok.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") close();
    });
  }

  /* ================= Экспорт ================= */

  window.Weather = {
    page,
    widget,
    refresh,
    load,
    setCity,
    toggleUnit,
    /* для радио и других страниц: данные и перерисовка «лишь бы видимого» экрана */
    data: () => S.weather.data,
    city: () => S.weather.city,
    convert,
    unit: () => S.weather.unit,
    onChange(fn) {
      const h = () => fn();
      window.addEventListener("weather:update", h);
      return () => window.removeEventListener("weather:update", h);
    },
  };

  window.WeatherViews = {
    views: { weather: page },
  };
  window.viewEl = window.viewEl || document.getElementById("view");

  /* Модуль рисует страницу сам, если стартовый вид — погода */
  /* На отдельной странице плеера нет — рисуем сразу и без виджета */
  if (!ownState) {
    document.title = "Погода · Шумерля";
    page();
  } else if (S.view === "weather") {
    page();
  }

  /* Автообновление: раз в 15 минут, и разово при возврате на вкладку */
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 15 * 60 * 1000);

  document.addEventListener("visibilitychange", () => {
    const w = S.weather;
    if (!document.hidden && (!w.data || Date.now() - w.data.at > 10 * 60 * 1000)) load(w.city);
  });

  if (!S.weather.data || Date.now() - S.weather.data.at > 10 * 60 * 1000) {
    load(S.weather.city);
  }
})();
