/* ============================================================
   Живой эфир: обложки, «сейчас играет», история, вкус из обложки.
   Обложки ищутся по названию трека через iTunes Search API — это
   не поток, «текущий трек» в эфир не подставляется. Служебные
   поля AzuraCast (id, isrc, text, lyrics) не показываем.
   ============================================================ */
(function () {
  "use strict";

  const ICONS = {
    heart: "M12 20.3 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8A4.7 4.7 0 0 1 19.4 13L12 20.3z",
    note: "M9 18.2a3.1 3.1 0 1 1 1.8-2.8V5l9-1.9v3.3l-7.2 1.5v7.1A3.1 3.1 0 0 1 9 18.2z",
    radio: "M3 8.2 15.8 4.4l.6 2-3.1.9H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.2a1 1 0 0 1 0-1zM5 9v9h14V9H5zm9.4 2.2a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zm0 1.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM7 10h4.6v1.8H7V10z",
  };

  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  /* ---------- Память: обложки по «исполнитель|трек» ---------- */

  const PRETTY_KEY = "uporota.pretty.v1";
  const pretty = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(PRETTY_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (e) {
      return {};
    }
  })();

  let saveTimer = null;
  function savePretty() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (Object.keys(pretty).length > 400) {
          const keys = Object.keys(pretty).slice(-300);
          const next = {};
          keys.forEach((k) => (next[k] = pretty[k]));
          localStorage.setItem(PRETTY_KEY, JSON.stringify(next));
        } else {
          localStorage.setItem(PRETTY_KEY, JSON.stringify(pretty));
        }
      } catch (e) {
        /* квота — не критично */
      }
    }, 900);
  }

  const nowPlaying = new Map(); // id станции → метаданные эфира
  const coverCache = new Map(); // ключ → url обложки
  const artTasks = new Map(); // ключ → промис поиска
  const listeners = new Set();

  function emit(kind, stationId) {
    listeners.forEach((fn) => {
      try {
        fn(kind, stationId);
      } catch (e) {
        console.warn(e);
      }
    });
  }

  /* ---------- Обложки: iTunes Search ---------- */

  const ART_TIMEOUT = 9000;

  function queryFor(artist, title, album) {
    const a = clean(artist).split("/")[0].replace(/\bfeat\.?\b.*/i, "").trim();
    const t = clean(title || album)
      .replace(/\((?:official|lyrics?|audio|video|visualizer)[^)]*\)/gi, "")
      .trim();
    return [a, t].filter(Boolean).join(" ").slice(0, 120);
  }

  function artFromHit(hit) {
    if (!hit || !hit.artworkUrl100) return "";
    return String(hit.artworkUrl100)
      .replace(/\/\d+x\d+bb\.(jpg|png)$/, "/600x600bb.$1")
      .replace("100x100", "600x600");
  }

  function lookupCover(artist, title, album) {
    const q = queryFor(artist, title, album);
    if (!q || q.length < 3) return Promise.resolve("");
    if (coverCache.has(q)) return Promise.resolve(coverCache.get(q));
    if (artTasks.has(q)) return artTasks.get(q);

    const task = (async () => {
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = setTimeout(() => ctrl && ctrl.abort(), ART_TIMEOUT);
      try {
        const url =
          "https://itunes.apple.com/search?limit=1&media=music&entity=song&country=ru&term=" +
          encodeURIComponent(q);
        const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
        if (!res.ok) return "";
        const data = await res.json();
        const hit = data && data.results && data.results[0];
        /* отбрасываем явно чужие совпадения: ни исполнителя, ни названия */
        if (hit && clean(hit.trackName).toLowerCase() !== clean(title).toLowerCase()) {
          const sameArtist = clean(hit.artistName).toLowerCase().includes(clean(artist).split(",")[0].toLowerCase());
          if (!sameArtist) return "";
        }
        const art = artFromHit(hit);
        if (art) coverCache.set(q, art);
        return art;
      } catch (e) {
        return "";
      } finally {
        clearTimeout(timer);
        artTasks.delete(q);
      }
    })();

    artTasks.set(q, task);
    return task;
  }

  /* ---------- Цвет из обложки ----------
     Маленькая canvas-копия, редкая сетка пикселей, почти серые
     отбрасываем. Возвращаем спокойный акцент, а не «RGB-геймер». */

  const TONES = {
    cool: "#8fa6d8",
    violet: "#9d8fd6",
    warm: "#d8a87a",
    ice: "#8fc0d8",
    teal: "#82c4b8",
    rose: "#d68fae",
    sand: "#cdb894",
  };

  const colorCache = new Map(); // url → { rgb, hsl, tone }

  function toneOf(h) {
    if (h < 24 || h >= 330) return "rose";
    if (h < 50) return "warm";
    if (h < 75) return "sand";
    if (h < 165) return "teal";
    if (h < 195) return "ice";
    if (h < 250) return "cool";
    return "violet";
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function extractColor(url) {
    if (!url) return Promise.resolve(null);
    if (colorCache.has(url)) return Promise.resolve(colorCache.get(url));

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";

      const done = (value) => {
        if (value) colorCache.set(url, value);
        resolve(value);
      };

      img.onload = () => {
        try {
          const size = 24;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return done(null);
          ctx.drawImage(img, 0, 0, size, size);
          const px = ctx.getImageData(0, 0, size, size).data;

          let best = null;
          for (let i = 0; i < px.length; i += 16) {
            const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
            if (a < 200 || (r < 18 && g < 18 && b < 18)) continue;
            const [h, s, l] = rgbToHsl(r, g, b);
            if (s < 0.22 || l < 0.14) continue;
            const score = s * Math.min(1, l * 1.8) * (1 - Math.abs(l - 0.5) * 0.7);
            if (!best || score > best.score) best = { r, g, b, h, score };
          }
          if (!best) return done(null);

          const [h2, s2, l2] = rgbToHsl(best.r, best.g, best.b);
          const sat = Math.min(0.6, Math.max(0.3, s2));
          const lit = Math.min(0.72, Math.max(0.52, l2));
          done({
            rgb: `${Math.round(best.r)} ${Math.round(best.g)} ${Math.round(best.b)}`,
            hsl: `${Math.round(h2)} ${Math.round(sat * 100)}% ${Math.round(lit * 100)}%`,
            tone: toneOf(h2),
          });
        } catch (e) {
          /* canvas «запачкан» — цвет возьмём из палитры станции */
          done(null);
        }
      };
      img.onerror = () => done(null);
      img.src = url;
    });
  }

  /* ---------- Названия: чиним «грязные» поля AzuraCast ---------- */

  function describe(raw) {
    let artist = clean(raw.artist);
    let title = clean(raw.title);
    let album = clean(raw.album);

    const text = clean(raw.text);
    if (!artist && !title && text) {
      const parts = text.split(" - ");
      artist = clean(parts[0]);
      title = clean(parts[1] || "");
      album = clean(parts[2] || "");
    }

    if (album && album.toLowerCase() === title.toLowerCase()) album = "";
    /* название повторяет альбом в скобках: «X (Deluxe)» → «X» */
    if (album) {
      const dup = new RegExp("\\s*[(\\[]" + album.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[)\\]]\\s*$", "i");
      const short = title.replace(dup, "");
      if (short.length > 2) title = short;
    }
    if (!title && album) title = album;

    const artists = artist.split("/").map(clean).filter(Boolean);
    return {
      artist: artists.slice(0, 2).join(", "),
      title,
      album,
      key: `${artists[0] || ""}|${title}`.toLowerCase(),
    };
  }

  /* ---------- История ---------- */

  const HISTORY = "uporota.history.v1";
  let history = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY) || "[]");
      return Array.isArray(raw) ? raw.filter((h) => h && h.title) : [];
    } catch (e) {
      return [];
    }
  })();

  let historyTimer = null;
  function saveHistory() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      try {
        localStorage.setItem(HISTORY, JSON.stringify(history.slice(0, 30)));
      } catch (e) {
        /* квота — не критично */
      }
    }, 600);
  }

  function historyKey(entry) {
    return `${entry.artist}|${entry.title}`.toLowerCase();
  }

  function remember(entry) {
    if (!entry || !entry.title) return;
    const key = historyKey(entry);
    const seen = history.findIndex((h) => historyKey(h) === key);
    if (seen >= 0) {
      /* был раньше — поднимаем наверх, обложка свежее из двух */
      const [old] = history.splice(seen, 1);
      entry = { ...old, ...entry, art: entry.art || old.art || "" };
    }
    history.unshift({ ...entry, at: Date.now() });
    history = history.slice(0, 30);
    saveHistory();
    emit("history");
  }

  /* Дорисовываем обложку в запись истории, когда её нашли */
  function patchHistoryArt(key, art) {
    const hit = history.find((h) => historyKey(h) === key);
    if (!hit || hit.art === art) return false;
    hit.art = art;
    saveHistory();
    return true;
  }

  /* ---------- Опрос AzuraCast ---------- */

  const pollTimers = new Map();
  let activeId = null;

  async function refresh(station) {
    if (!station || !station.nowplaying) return;
    let data;
    try {
      const res = await fetch(station.nowplaying, { cache: "no-store" });
      if (!res.ok) return;
      data = await res.json();
    } catch (e) {
      return; /* сеть/CORS — тихо, интерфейс живёт на палитре станции */
    }

    const np = (data && data.now_playing) || {};
    const song = np.song || {};
    const info = describe(song);
    if (!info.title) return;

    const prev = nowPlaying.get(station.id);
    if (prev && prev.key === info.key) {
      /* тот же трек — только время и слушатели */
      prev.elapsed = Number(np.elapsed) || 0;
      prev.listeners = stationListenerCount(data, station);
      emit("tick", station.id);
      return;
    }

    const duration = Number(np.duration) || 0;
    const elapsed = Number(np.elapsed) || 0;
    const meta = {
      stationId: station.id,
      stationName: station.name,
      artist: info.artist,
      title: info.title,
      album: info.album,
      key: info.key,
      listeners: stationListenerCount(data, station),
      duration,
      elapsed,
      progress: duration ? Math.min(1, elapsed / duration) : 0,
      live: !!(data.live && data.live.is_live),
      art: (pretty[info.key] && pretty[info.key].art) || "",
      color: null,
      at: Date.now(),
    };

    nowPlaying.set(station.id, meta);
    emit("now", station.id);

    /* старый трек — в историю, он действительно играл */
    if (prev && prev.title) {
      remember({
        artist: prev.artist,
        title: prev.title,
        album: prev.album,
        stationId: prev.stationId,
        stationName: prev.stationName,
        art: prev.art || "",
      });
    }

    /* серверная история: дописываем треки, которых у нас ещё нет */
    const hist = Array.isArray(data.song_history) ? data.song_history : [];
    hist.slice(0, 6).reverse().forEach((h) => {
      const hid = describe((h && h.song) || {});
      if (!hid.title) return;
      if (history.some((x) => historyKey(x) === hid.key)) return;
      history.push({
        artist: hid.artist,
        title: hid.title,
        album: hid.album,
        stationId: station.id,
        stationName: station.name,
        at: (Number(h.played_at) || 0) * 1000,
      });
    });
    history = history.slice(0, 30);
    saveHistory();
    emit("history");

    const wanted = meta.art || (await lookupCover(info.artist, info.title, info.album));
    if (!wanted) return;
    if (wanted !== meta.art) {
      pretty[info.key] = { art: wanted };
      savePretty();
    }
    const current = nowPlaying.get(station.id);
    if (!current || current.key !== info.key) return;

    const color = await extractColor(wanted);
    current.art = wanted;
    current.color = color;
    if (patchHistoryArt(info.key, wanted)) emit("history");
    emit("art", station.id);
  }

  function stationListenerCount(data, station) {
    if (!data) return null;
    const mounts = data.station && Array.isArray(data.station.mounts) ? data.station.mounts : [];
    const own = mounts.find((m) => m && station.stream && String(m.url || "").includes(station.stream.split("/").pop()));
    const n = own && own.listeners ? own.listeners.current : null;
    if (typeof n === "number") return n;
    const total = (data.station && data.station.listeners && data.station.listeners.current) || null;
    if (typeof total === "number") return total;
    return (data.listeners && data.listeners.current) || null;
  }

  /* ---------- Публичный интерфейс ---------- */

  window.RadioLive = {
    now: (id) => nowPlaying.get(id) || null,
    history: () => history.slice(),
    remember,
    tone: (name) => TONES[name] || TONES.cool,
    describe,
    prefetchCover: (artist, title, album) => lookupCover(artist, title, album),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start(station) {
      if (!station || !station.nowplaying) return;
      activeId = station.id;
      if (pollTimers.has(station.id)) return;
      refresh(station);
      pollTimers.set(station.id, setInterval(() => refresh(station), 25000));
      if (pollTimers.size > 4) {
        for (const [id, timer] of pollTimers) {
          if (id !== activeId) {
            clearInterval(timer);
            pollTimers.delete(id);
            break;
          }
        }
      }
    },
    stopAll() {
      for (const timer of pollTimers.values()) clearInterval(timer);
      pollTimers.clear();
    },
  };

  window.addEventListener("pagehide", () => window.RadioLive.stopAll());
})();
