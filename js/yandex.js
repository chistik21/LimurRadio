/* ==========================================================
   Limurane · Яндекс Музыка (поиск и ссылки на треки)
   Публичный поиск Яндекс Музыки без ключа. Звук — только
   официальный путь: открытие страницы трека на music.yandex.ru.
   ========================================================== */
(function () {
  "use strict";

  if (typeof state === "undefined" || typeof el !== "function") return;

  const LS_TRACKS = "limurane.yandex.tracks";
  const LS_RECENT = "limurane.yandex.recent";

  const API = "https://api.music.yandex.ru";
  const WEB = "https://music.yandex.ru";

  state.yandex = state.yandex || {
    query: "",
    results: null, /* {trackIds, artists, albums, playlists} */
    loading: false,
    error: null,
    apiOk: null, /* неизвестно, работает ли API */
  };
  state.yandexCache = state.yandexCache || new Map();

  /* ================= ID треков ================= */

  function ydId(raw) {
    return "y" + raw;
  }
  function rawId(id) {
    return String(id || "").replace(/^y/, "");
  }

  function entryFromYandex(t) {
    const artists = (t.artists || []).map((a) => a.name);
    const cover = t.cover ? yandexCoverUrl(t.cover) : "";
    return {
      id: ydId(t.id),
      title: t.title || "Без названия",
      artist: artists.join(", ") || "Неизвестный исполнитель",
      album: t.album ? (t.album.title || "") : "",
      duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : 0,
      added: Date.now(),
      hasCover: false,
      source: "yandex",
      coverUrl: cover,
      url: `${WEB}/album/${(t.album && t.album.id) || ""}/track/${t.id}`,
    };
  }

  function yandexCoverUrl(coverId, size = "400x400") {
    if (!coverId) return "";
    /* Яндекс отдаёт обложки по разным хостам; пробуем основной */
    return `https://og-image.music.yandex.ru/${coverId}/${size}`;
  }

  function registerEntry(entry) {
    if (!state.tracks.has(entry.id)) state.tracks.set(entry.id, entry);
    if (entry.coverUrl) state.coverUrls.set(entry.id, entry.coverUrl);
    return entry.id;
  }

  function registerYandexTrack(t) {
    return registerEntry(entryFromYandex(t));
  }

  function saveYandexTracks() {
    try {
      const arr = [...state.tracks.values()].filter((t) => t.source === "yandex").slice(0, 300);
      localStorage.setItem(LS_TRACKS, JSON.stringify(arr));
    } catch (e) {
      console.warn("Яндекс-треки не сохранены", e);
    }
  }

  function loadYandexTracks() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_TRACKS) || "[]");
      if (!Array.isArray(arr)) return;
      for (const t of arr) {
        if (t && t.id && t.source === "yandex") {
          if (!state.tracks.has(t.id)) state.tracks.set(t.id, t);
          if (t.coverUrl) state.coverUrls.set(t.id, t.coverUrl);
        }
      }
    } catch (e) {
      console.warn("Яндекс-треки не загружены", e);
    }
  }

  function loadRecent() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_RECENT) || "[]");
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  function pushRecent(id) {
    if (!id) return;
    let arr = loadRecent();
    arr = [id, ...arr.filter((x) => x !== id)].slice(0, 12);
    try {
      localStorage.setItem(LS_RECENT, JSON.stringify(arr));
    } catch {
      /* не критично */
    }
  }

  function onTrackDeleted(id) {
    const t = state.tracks.get(id);
    if (!t || t.source !== "yandex") return;
    state.tracks.delete(id);
    state.coverUrls.delete(id);
    state.favorites = state.favorites.filter((x) => x !== id);
    state.playlists.forEach((p) => (p.trackIds = p.trackIds.filter((x) => x !== id)));
    saveState();
    saveYandexTracks();
    render();
    refreshSidebar();
    toast(`Трек «${t.title}» удалён`);
  }

  function artistsNames(list) {
    return (list || []).map((a) => a.name).join(", ") || "Неизвестный исполнитель";
  }

  /* ================= Запросы к Яндекс Музыке ================= */

  function ydHeaders() {
    return {
      Accept: "application/json",
      "X-Yandex-Music-Client-Name": "Web",
      "X-Yandex-Music-Client-Version": "2.0",
      "Origin": WEB,
      "Referer": WEB + "/",
    };
  }

  async function ydFetch(path, params) {
    const url = API + path + (params ? "?" + new URLSearchParams(params) : "");
    const resp = await fetch(url, { headers: ydHeaders() });
    if (!resp.ok) throw new Error("Яндекс Музыка: HTTP " + resp.status);
    return resp.json();
  }

  /* ================= Поиск ================= */

  async function searchAll(q) {
    state.yandex.query = q;
    state.yandex.loading = true;
    state.yandex.results = null;
    state.yandex.error = null;
    render();
    try {
      let data;
      try {
        data = await ydFetch("/search", {
          text: q,
          type: "track,album,artist,playlist",
          nocsd: "1",
        });
        state.yandex.apiOk = true;
      } catch (e) {
        state.yandex.apiOk = false;
        state.yandex.error = "api";
        throw e;
      }
      const res = data && data.result ? data.result : {};
      const trackIds = [];
      for (const t of res.tracks && res.tracks.results || []) {
        if (!t || !t.id) continue;
        trackIds.push(registerYandexTrack(t));
      }
      state.yandex.results = {
        trackIds,
        artists: (res.artists && res.artists.results || []).filter((a) => a && a.id),
        albums: (res.albums && res.albums.results || []).filter((a) => a && a.id),
        playlists: (res.playlists && res.playlists.results || []).filter((p) => p && p.id),
      };
      saveYandexTracks();
    } catch (e) {
      state.yandex.error = e.message === "NO_AUTH" ? "auth" : (e && e.message) || "Ошибка поиска Яндекс";
      console.warn("Яндекс: поиск не удался", e);
    }
    state.yandex.loading = false;
    render();
  }

  /* ================= UI ================= */

  function ydSpinner(text) {
    const spin = el("div", "spinner-wrap");
    const s = el("div", "spinner");
    spin.appendChild(s);
    spin.appendChild(el("span", null, text || "Ищу в Яндекс Музыке…"));
    return spin;
  }

  function statusBar() {
    const wrap = el("div", "yd-status");
    wrap.appendChild(el("div", "yd-label",
      "Яндекс Музыка — каталог без входа. Треки открываются на music.yandex.ru."));
    const btn = el("button", "btn primary", "Поиск в Яндекс Музыке");
    btn.type = "button";
    btn.addEventListener("click", () => {
      const q = state.yandex.query || "";
      const url = `${WEB}/search?text=${encodeURIComponent(q)}`;
      window.open(url, "_blank", "noopener");
    });
    wrap.appendChild(btn);
    return wrap;
  }

  function buildHero(kicker, title, metaText, coverUrl) {
    const hero = el("div", "hero");
    const coverWrap = el("div", "hero-cover card-stacked");
    const inner = el("div", "card-cover");
    if (coverUrl) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = coverUrl;
      img.onerror = () => img.remove();
      inner.appendChild(img);
    } else {
      inner.appendChild(svgUse(ICONS.music));
    }
    coverWrap.appendChild(inner);
    hero.appendChild(coverWrap);

    const text = el("div", "hero-text");
    text.appendChild(el("div", "hero-kicker", kicker));
    text.appendChild(el("h1", "hero-title", title));
    text.appendChild(el("div", "hero-meta"));
    const meta = text.querySelector(".hero-meta");
    if (meta) meta.append(document.createTextNode(metaText));
    hero.appendChild(text);
    return hero;
  }

  function metaCard({ title, sub, coverUrl, onOpen }) {
    const card = el("div", "card");
    const cover = el("div", "card-cover");
    if (coverUrl) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = coverUrl;
      img.onerror = () => img.remove();
      cover.appendChild(img);
    } else {
      cover.appendChild(svgUse(ICONS.music));
    }
    const badge = el("span", "sp-badge", "YM");
    badge.title = "Яндекс Музыка";
    cover.appendChild(badge);
    card.appendChild(cover);
    card.appendChild(el("div", "card-title", title));
    card.appendChild(el("div", "card-sub", sub));
    card.addEventListener("click", onOpen);
    return card;
  }

  function resultsInto(container) {
    const res = state.yandex.results;
    if (!res) return;
    if (res.trackIds.length) {
      const sec = makeSection("Яндекс · Треки", "сброс", clearYandexResults);
      sec.appendChild(makeTrackList(res.trackIds));
      container.appendChild(sec);
    }
    if (res.artists.length) {
      const sec = makeSection("Яндекс · Исполнители", null, null);
      const grid = el("div", "grid");
      for (const a of res.artists) {
        grid.appendChild(metaCard({
          title: a.name,
          sub: "Исполнитель",
          coverUrl: a.cover ? yandexCoverUrl(a.cover) : "",
          onOpen: () => navigate("yandex-artist", { id: a.id, name: a.name, cover: a.cover }),
        }));
      }
      sec.appendChild(grid);
      container.appendChild(sec);
    }
    if (res.albums.length) {
      const sec = makeSection("Яндекс · Альбомы", null, null);
      const grid = el("div", "grid");
      for (const a of res.albums) {
        grid.appendChild(metaCard({
          title: a.title,
          sub: artistsNames(a.artists),
          coverUrl: a.cover ? yandexCoverUrl(a.cover) : "",
          onOpen: () => navigate("yandex-album", { id: a.id, name: a.title, artists: a.artists, cover: a.cover }),
        }));
      }
      sec.appendChild(grid);
      container.appendChild(sec);
    }
    if (res.playlists.length) {
      const sec = makeSection("Яндекс · Плейлисты", null, null);
      const grid = el("div", "grid");
      for (const p of res.playlists) {
        grid.appendChild(metaCard({
          title: p.title,
          sub: (p.owner && p.owner.login) || "Плейлист",
          coverUrl: p.cover ? yandexCoverUrl(p.cover) : "",
          onOpen: () => navigate("yandex-playlist", { id: p.id, name: p.title, login: p.owner && p.owner.login, kind: p.kind }),
        }));
      }
      sec.appendChild(grid);
      container.appendChild(sec);
    }
    if (!res.trackIds.length && !res.artists.length && !res.albums.length && !res.playlists.length) {
      container.appendChild(makeEmptyState({
        icon: ICONS.search,
        title: "В Яндекс Музыке такого не нашлось",
        text: "Попробуйте другое слово или исполнителя.",
      }));
    }
  }

  function errorHintInto(container) {
    if (state.yandex.error === "api") {
      container.appendChild(el("p", "sp-hint",
        "Каталог Яндекс Музыки пока недоступен напрямую (CORS). Нажмите «Поиск в Яндекс Музыке», чтобы открыть каталог в браузере."));
    } else if (state.yandex.error) {
      container.appendChild(el("p", "sp-hint", "Яндекс Музыка: " + state.yandex.error));
    }
  }

  function clearYandexResults() {
    state.yandex.query = "";
    state.yandex.results = null;
    state.yandex.loading = false;
    state.yandex.error = null;
    render();
  }

  /* ================= Облако: параллельный поиск Яндекс ================= */

  function cloudHook(q) {
    const text = (q || "").trim();
    const isArchiveExpr = /[:()]|\bAND\b|\bOR\b/i.test(text);
    if (!text || isArchiveExpr) {
      state.yandex.query = "";
      state.yandex.results = null;
      state.yandex.error = null;
      state.yandex.loading = false;
      return;
    }
    searchAll(text);
  }

  /* ================= Общий поиск ================= */

  let ydUnifyTimer = null;
  function onUnifiedQuery(q) {
    const text = (q || "").trim();
    clearTimeout(ydUnifyTimer);
    if (!text) {
      if (state.yandex.results) {
        state.yandex.query = "";
        state.yandex.results = null;
        state.yandex.error = null;
      }
      return;
    }
    ydUnifyTimer = setTimeout(async () => {
      const current = (state.query || "").trim();
      if (!current || text !== current) return;
      await searchAll(current);
    }, 600);
  }

  /* ================= searchMount для общего поиска ================= */

  function searchMount() {
    const mount = document.createElement("div");
    mount.id = "ydUnifiedMount";
    if (state.yandex.loading) {
      mount.appendChild(ydSpinner());
      return mount;
    }
    if (state.yandex.error && state.yandex.error !== "api") {
      mount.appendChild(el("p", "sp-hint", "Яндекс Музыка: " + state.yandex.error));
      return mount;
    }
    if (state.yandex.results && state.yandex.query === (state.query || "").trim()) {
      mount.appendChild(el("div", "sp-mount-head"));
      mount.querySelector(".sp-mount-head").appendChild(el("div", "hero-kicker", "каталог Яндекс Музыки"));
      resultsInto(mount);
    }
    return mount;
  }

  /* ================= Воспроизведение ================= */

  function openYandex(track) {
    if (!track || track.source !== "yandex" || !track.url) return;
    pushRecent(track.id);
    toast("Открываю трек в Яндекс Музыке");
    window.open(track.url, "_blank", "noopener");
  }

  function closeYandex() { /* не требуется, нет overlays */ }

  /* ================= Виды ================= */

  async function viewWrapper(fn) {
    viewEl.appendChild(makeViewBack());
    try {
      await fn();
    } catch (e) {
      console.warn("Яндекс: страница не открылась", e);
      viewEl.appendChild(makeEmptyState({
        icon: ICONS.search,
        title: "Не удалось открыть страницу Яндекс Музыки",
        text: (e && e.message) || "Попробуйте ещё раз.",
        actionLabel: "Вернуться",
        actionFn: () => navigate("yandex"),
      }));
    }
  }

  function viewYandexHome() {
    const hero = el("div", "hero");
    const coverWrap = el("div", "hero-placeholder big");
    coverWrap.appendChild(svgUse(ICONS.music));
    hero.appendChild(coverWrap);
    const text = el("div", "hero-text");
    text.appendChild(el("div", "hero-kicker", "Каталог"));
    text.appendChild(el("h1", "hero-title", "Яндекс Музыка"));
    text.appendChild(el("div", "hero-meta"));
    $(".hero-meta", text).append(document.createTextNode("Поиск по каталогу Яндекс Музыки без входа"));
    hero.appendChild(text);
    viewEl.appendChild(hero);

    viewEl.appendChild(statusBar());

    const form = el("form", "cloud-search");
    form.setAttribute("role", "search");
    const input = el("input");
    input.type = "search";
    input.placeholder = "Поиск в Яндекс Музыке: трек, альбом, исполнитель…";
    input.value = state.yandex.query || "";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Поиск в Яндекс Музыке");
    const btn = el("button", "btn primary", "Найти");
    btn.type = "submit";
    form.appendChild(input);
    form.appendChild(btn);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) searchAll(text);
    });
    viewEl.appendChild(form);

    if (state.yandex.loading) {
      viewEl.appendChild(ydSpinner());
      return;
    }
    if (state.yandex.error === "api") {
      errorHintInto(viewEl);
      const openWeb = el("button", "btn primary", "Открыть Яндекс Музыку в браузере");
      openWeb.addEventListener("click", () => {
        const q = state.yandex.query || "";
        window.open(`${WEB}/search?text=${encodeURIComponent(q)}`, "_blank", "noopener");
      });
      viewEl.appendChild(openWeb);
      return;
    }
    if (state.yandex.results && state.yandex.query) {
      resultsInto(viewEl);
      return;
    }

    const recent = loadRecent().filter((id) => state.tracks.has(id) && state.tracks.get(id).source === "yandex");
    const secR = makeSection("Недавно открывали", recent.length ? "очистить" : null, () => {
      localStorage.removeItem(LS_RECENT);
      render();
    });
    if (recent.length) {
      secR.appendChild(makeTrackList(recent));
    } else {
      const hint = el("p", null, "Пока пусто. Найдите трек и нажмите на него — он появится здесь.");
      hint.style.color = "var(--text-dim)";
      hint.style.fontSize = "14px";
      secR.appendChild(hint);
    }
    viewEl.appendChild(secR);
  }

  function viewYandexTrack() {
    const base = state.viewData && typeof state.viewData === "object" ? state.viewData : { id: state.viewData };
    if (!base.id) { navigate("yandex"); return; }
    viewWrapper(async () => {
      let t;
      try {
        const data = await ydFetch("/tracks/" + encodeURIComponent(rawId(base.id)));
        t = data.track;
      } catch (e) {
        t = state.tracks.get(base.id) || null;
      }
      if (!t) { navigate("yandex"); return; }
      const entry = entryFromYandex(t);
      registerEntry(entry);
      saveYandexTracks();
      pushRecent(entry.id);

      viewEl.appendChild(buildHero(
        "Трек Яндекс Музыки",
        entry.title,
        entry.artist + (entry.duration ? " · " + fmtTime(entry.duration) : ""),
        entry.coverUrl
      ));

      const actions = el("div", "hero-actions");
      const openBtn = el("button", "btn primary", "▶ Слушать в Яндекс Музыке");
      openBtn.setAttribute("aria-label", "Открыть трек в Яндекс Музыке");
      openBtn.addEventListener("click", () => openYandex(entry));
      actions.appendChild(openBtn);
      viewEl.appendChild(actions);

      const favBtn = el("button", "btn ghost", state.favorites.includes(entry.id) ? "♥ В избранном" : "♡ В избранное");
      favBtn.addEventListener("click", () => {
        toggleFavorite(entry.id);
        favBtn.textContent = state.favorites.includes(entry.id) ? "♥ В избранном" : "♡ В избранное";
      });
      viewEl.appendChild(favBtn);

      if (entry.url) {
        const webBtn = el("button", "btn ghost", "Открыть на Яндекс Музыке ↗");
        webBtn.addEventListener("click", () => window.open(entry.url, "_blank", "noopener"));
        viewEl.appendChild(webBtn);
      }
    });
  }

  function viewYandexAlbum() {
    const base = state.viewData;
    if (!base || !base.id) { navigate("yandex"); return; }
    viewWrapper(async () => {
      let album;
      try {
        const data = await ydFetch("/albums/" + encodeURIComponent(rawId(base.id)));
        album = data.album;
      } catch (e) {
        album = { id: base.id, title: base.name || "Альбом", artists: base.artists || [], cover: base.cover, tracks: { items: [] } };
      }
      viewEl.appendChild(buildHero(
        "Альбом Яндекс Музыки",
        album.title || base.name || "Альбом",
        artistsNames(album.artists || base.artists) +
          (album.tracks && album.tracks.items ? " · " + album.tracks.items.length + " трек(ов)" : "") +
          (album.year ? " · " + album.year : ""),
        album.cover ? yandexCoverUrl(album.cover) : ""
      ));
      const ids = [];
      for (const item of (album.tracks && album.tracks.items) || []) {
        if (item && item.id) ids.push(registerYandexTrack(item));
      }
      saveYandexTracks();
      if (ids.length) {
        const sec = makeSection("Треки альбома");
        sec.appendChild(makeTrackList(ids));
        viewEl.appendChild(sec);
        const hint = el("p", "sp-hint", "Нажмите на трек — он откроется в Яндекс Музыке.");
        viewEl.appendChild(hint);
      } else {
        viewEl.appendChild(makeEmptyState({ icon: ICONS.music, title: "Треков не нашлось", text: "Возможно, альбом скрыт в вашем регионе." }));
      }
    });
  }

  function viewYandexArtist() {
    const base = state.viewData;
    if (!base || !base.id) { navigate("yandex"); return; }
    viewWrapper(async () => {
      let artist;
      try {
        const data = await ydFetch("/artists/" + encodeURIComponent(rawId(base.id)));
        artist = data.artist;
      } catch (e) {
        artist = { id: base.id, name: base.name || "Исполнитель", cover: base.cover, genres: [] };
      }
      const cover = artist.cover ? yandexCoverUrl(artist.cover) : "";
      viewEl.appendChild(buildHero(
        "Исполнитель Яндекс Музыки",
        artist.name || base.name || "Исполнитель",
        (artist.genres && artist.genres.length ? artist.genres.slice(0, 3).join(" · ") : "Исполнитель"),
        cover
      ));

      /* Альбомы исполнителя */
      const sec = makeSection("Альбомы", null, null);
      const grid = el("div", "grid");
      try {
        const data = await ydFetch("/artists/" + encodeURIComponent(rawId(base.id)) + "/albums", { limit: "12" });
        for (const a of data.artists && data.artists[0] && data.artists[0].albums && data.artists[0].albums.items || []) {
          if (a && a.id) {
            grid.appendChild(metaCard({
              title: a.title,
              sub: a.year || "Альбом",
              coverUrl: a.cover ? yandexCoverUrl(a.cover) : "",
              onOpen: () => navigate("yandex-album", { id: a.id, name: a.title, artists: artist ? [{ name: artist.name }] : [], cover: a.cover }),
            }));
          }
        }
      } catch (e) {
        console.warn("Яндекс: альбомы исполнителя", e);
      }
      sec.appendChild(grid);
      viewEl.appendChild(sec);
    });
  }

  function viewYandexPlaylist() {
    const base = state.viewData;
    if (!base || !base.id) { navigate("yandex"); return; }
    viewWrapper(async () => {
      /* Плейлисты требуют логин+kind; если нет — показываем ссылку */
      const pl = { id: base.id, title: base.name || "Плейлист", owner: { login: base.login || "" }, kind: base.kind || "", cover: base.cover };
      viewEl.appendChild(buildHero(
        "Плейлист Яндекс Музыки",
        pl.title,
        pl.owner.login ? "автор: " + pl.owner.login : "Плейлист",
        pl.cover ? yandexCoverUrl(pl.cover) : ""
      ));
      if (pl.owner.login && pl.kind) {
        try {
          const data = await ydFetch(`/users/${encodeURIComponent(pl.owner.login)}/playlists/${encodeURIComponent(pl.kind)}`);
          const p = data.playlist;
          const ids = [];
          for (const item of (p.tracks && p.tracks.items) || []) {
            const tr = item && item.track;
            if (tr && tr.id) ids.push(registerYandexTrack(tr));
          }
          saveYandexTracks();
          if (ids.length) {
            const sec = makeSection("Треки плейлиста");
            sec.appendChild(makeTrackList(ids));
            viewEl.appendChild(sec);
          }
        } catch (e) {
          console.warn("Яндекс: плейлист", e);
        }
      }
      const webBtn = el("button", "btn primary", "Открыть плейлист в Яндекс Музыке");
      webBtn.addEventListener("click", () => {
        const url = pl.owner.login && pl.kind
          ? `${WEB}/users/${encodeURIComponent(pl.owner.login)}/playlists/${encodeURIComponent(pl.kind)}`
          : `${WEB}/search?text=${encodeURIComponent(pl.title)}`;
        window.open(url, "_blank", "noopener");
      });
      viewEl.appendChild(webBtn);
    });
  }

  const views = {
    yandex: viewYandexHome,
    "yandex-track": viewYandexTrack,
    "yandex-album": viewYandexAlbum,
    "yandex-artist": viewYandexArtist,
    "yandex-playlist": viewYandexPlaylist,
  };

  /* ================= Экспорт ================= */

  window.YandexViews = {
    statusBar,
    cloudHook,
    searchMount,
    onUnifiedQuery,
    openYandex,
    closeYandex,
    views,
    onTrackDeleted,
    searchAll,
  };

  loadYandexTracks();
})();
