/* ==========================================================
   Limurane · Spotify (официальный Web API, OAuth 2.0 + PKCE)
   Только метаданные, поиск и обложки. Аудио через API не
   выдаётся — клик по треку открывает его страницу на Spotify.
   Никакого Client Secret: только client_id + PKCE.
   ========================================================== */
(function () {
  "use strict";

  /* Глобальные привязки player.js (классический скрипт, общая область) */
  if (typeof state === "undefined" || typeof el !== "function") return;

  const LS_TOKEN = "limurane.spotify.token";
  const LS_VERIF = "limurane.spotify.verifier";
  const LS_STATE = "limurane.spotify.state";
  const LS_CLIENT = "limurane.spotify.clientId";
  const LS_TRACKS = "limurane.spotify.tracks";

  const API = "https://api.spotify.com/v1";
  const AUTH_URL = "https://accounts.spotify.com/authorize";
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const SEARCH_LIMIT = 6; /* у dev-приложений лимиты lowered — не просим больше */

  /* --- Рабочее состояние секций Spotify --- */
  state.spotify = state.spotify || {
    query: "",
    results: null, /* {trackIds, artists, albums, playlists} */
    loading: false,
    error: null,
  };
  state.spAlbumCache = state.spAlbumCache || new Map();

  /* ================= Токены (PKCE, без секрета) ================= */

  function readToken() {
    try {
      const t = JSON.parse(localStorage.getItem(LS_TOKEN) || "null");
      return t && t.access_token ? t : null;
    } catch {
      return null;
    }
  }

  function clientId() {
    return (localStorage.getItem(LS_CLIENT) || "").trim();
  }

  function isConnected() {
    return !!readToken() && !!clientId();
  }

  function b64url(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function sha256(verifier) {
    const data = new TextEncoder().encode(verifier);
    const buf = await window.crypto.subtle.digest("SHA-256", data);
    return b64url(new Uint8Array(buf));
  }

  async function refreshToken(token) {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: clientId(),
      }),
    });
    if (!resp.ok) throw new Error("Обновление токена не удалось (HTTP " + resp.status + ")");
    const data = await resp.json();
    const t = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || token.refresh_token,
      expires_at: Date.now() + Math.max(60, (data.expires_in || 3600) - 90) * 1000,
    };
    localStorage.setItem(LS_TOKEN, JSON.stringify(t));
    return t;
  }

  async function getToken() {
    let t = readToken();
    if (!t) return null;
    if (t.expires_at - Date.now() > 60000) return t; /* обновляем за минуту до конца */
    if (!t.refresh_token) {
      logout(false);
      return null;
    }
    try {
      return await refreshToken(t);
    } catch (e) {
      console.warn("Spotify: не удалось обновить токен", e);
      if (/400|401/.test(String(e.message))) {
        logout(false);
        toast("Вход Spotify истёк — войдите заново");
      }
      return null;
    }
  }

  async function api(path, params) {
    const t = await getToken();
    if (!t) throw new Error("NO_AUTH");
    let url = API + path + (params ? "?" + new URLSearchParams(params) : "");
    let resp = await fetch(url, { headers: { Authorization: "Bearer " + t.access_token } });
    if (resp.status === 401) {
      /* одноразовый ретрай: сбрасываем и запрашиваем новый токен */
      await refreshToken(t);
      const t2 = readToken();
      if (!t2) throw new Error("NO_AUTH");
      resp = await fetch(url, { headers: { Authorization: "Bearer " + t2.access_token } });
    }
    if (resp.status === 429) {
      const ra = Number(resp.headers.get && resp.headers.get("retry-after")) || 0;
      throw new Error(ra ? "Слишком много запросов — подождите " + ra + " с" : "Слишком много запросов к Spotify");
    }
    if (resp.status === 404) throw new Error("Не найдено в Spotify");
    if (!resp.ok) throw new Error("Spotify API: HTTP " + resp.status);
    return resp.json();
  }

  function logout(notify = true) {
    localStorage.removeItem(LS_TOKEN);
    if (notify) {
      toast("Вход Spotify отключён");
      render();
    }
  }

  async function login() {
    const cid = clientId();
    if (!cid) {
      toast("Сначала вставьте Client ID из Spotify Dashboard");
      return;
    }
    if (!window.crypto || !window.crypto.subtle) {
      toast("Браузер не поддерживает PKCE");
      return;
    }
    const verifier = b64url(window.crypto.getRandomValues(new Uint8Array(64)));
    const challenge = await sha256(verifier);
    const st = b64url(window.crypto.getRandomValues(new Uint8Array(24)));
    localStorage.setItem(LS_VERIF, verifier);
    localStorage.setItem(LS_STATE, st);
    const redirect = location.origin + location.pathname.replace(/[^/]*$/, "") + "callback.html";
    const url = AUTH_URL + "?" + new URLSearchParams({
      client_id: cid,
      response_type: "code",
      redirect_uri: redirect,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state: st,
    });
    location.assign(url);
  }

  /* ================= Регистрация треков в Limurane ================= */

  const SP_PREFIX = "s";
  function spId(raw) {
    return SP_PREFIX + raw;
  }

  function entryFromSpotify(t) {
    const artists = (t.artists || []).map((a) => a.name);
    const images = (t.album && t.album.images) || [];
    const cover = images.length ? images[0].url : "";
    return {
      id: spId(t.id),
      title: t.name || "Без названия",
      artist: artists.join(", ") || "Неизвестный исполнитель",
      album: (t.album && t.album.name) || "",
      duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : 0,
      added: Date.now(),
      hasCover: false,
      source: "spotify",
      coverUrl: cover,
      url: (t.external_urls && t.external_urls.spotify) || "",
    };
  }

  function registerEntry(entry) {
    if (!state.tracks.has(entry.id)) state.tracks.set(entry.id, entry);
    if (entry.coverUrl) state.coverUrls.set(entry.id, entry.coverUrl);
    return entry.id;
  }

  function registerSpotifyTrack(t) {
    return registerEntry(entryFromSpotify(t));
  }

  function saveSpotifyTracks() {
    try {
      const arr = [...state.tracks.values()].filter((t) => t.source === "spotify").slice(0, 300);
      localStorage.setItem(LS_TRACKS, JSON.stringify(arr));
    } catch (e) {
      console.warn("Spotify-треки не сохранены", e);
    }
  }

  function loadSpotifyTracks() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_TRACKS) || "[]");
      if (!Array.isArray(arr)) return;
      for (const t of arr) {
        if (t && t.id && t.source === "spotify") {
          if (!state.tracks.has(t.id)) state.tracks.set(t.id, t);
          if (t.coverUrl) state.coverUrls.set(t.id, t.coverUrl);
        }
      }
    } catch (e) {
      console.warn("Spotify-треки не загружены", e);
    }
  }

  function onTrackDeleted(id) {
    const t = state.tracks.get(id);
    if (!t || t.source !== "spotify") return;
    state.tracks.delete(id);
    state.coverUrls.delete(id);
    state.favorites = state.favorites.filter((x) => x !== id);
    state.playlists.forEach((p) => (p.trackIds = p.trackIds.filter((x) => x !== id)));
    saveState();
    saveSpotifyTracks();
    render();
    refreshSidebar();
    toast(`Трек «${t.title}» удалён`);
  }

  function artistsNames(list) {
    return (list || []).map((a) => a.name).join(", ") || "Неизвестный исполнитель";
  }

  /* ================= Поиск (объединённые результаты) ================= */

  async function searchAll(q) {
    state.spotify.query = q;
    state.spotify.loading = true;
    state.spotify.results = null;
    state.spotify.error = null;
    render();
    try {
      if (!isConnected()) {
        state.spotify.error = "auth";
      } else {
        const data = await api("/search", { q, type: "track,album,artist,playlist", limit: String(SEARCH_LIMIT) });
        const trackIds = [];
        for (const t of data.tracks && data.tracks.items || []) {
          if (!t || !t.id) continue;
          trackIds.push(registerSpotifyTrack(t));
        }
        state.spotify.results = {
          trackIds,
          artists: (data.artists && data.artists.items || []).filter((a) => a && a.id),
          albums: (data.albums && data.albums.items || []).filter((a) => a && a.id),
          playlists: (data.playlists && data.playlists.items || []).filter((p) => p && p.id),
        };
        saveSpotifyTracks();
      }
    } catch (e) {
      state.spotify.error = e.message === "NO_AUTH" ? "auth" : (e && e.message) || "Ошибка поиска";
      console.warn("Spotify: поиск не удался", e);
    }
    state.spotify.loading = false;
    render();
  }

  /* Хук облачного поиска: Spotify ищет тем же запросом параллельно.
     Архивные выражения (collection:..., AND/OR) на Spotify не отправляем. */
  function cloudHook(q) {
    const text = (q || "").trim();
    const isArchiveExpr = /[:()]|\bAND\b|\bOR\b/i.test(text);
    if (!text || isArchiveExpr) {
      state.spotify.query = "";
      state.spotify.results = null;
      state.spotify.error = null;
      state.spotify.loading = false;
      return;
    }
    searchAll(text); /* не ждём: архив ищется и рендерится сам */
  }

  /* ================= UI: строка подключения и результаты ================= */

  function statusBar() {
    const wrap = el("div", "sp-status");
    wrap.appendChild(el("div", "sp-label", "Spotify — официальный Web API. Вставьте Client ID приложения (dashboard → Web API), затем войдите."));
    const input = el("input");
    input.type = "text";
    input.placeholder = "Client ID приложения Spotify";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = clientId();
    input.setAttribute("aria-label", "Client ID приложения Spotify");
    input.addEventListener("change", () => {
      localStorage.setItem(LS_CLIENT, input.value.trim());
      if (input.value.trim()) toast("Client ID сохранён");
    });
    wrap.appendChild(input);
    const btn = el("button", "btn primary", readToken() ? "Выйти" : "Войти");
    btn.type = "button";
    btn.setAttribute("aria-label", readToken() ? "Отключить Spotify" : "Войти в Spotify");
    btn.addEventListener("click", () => (readToken() ? logout() : login()));
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
      img.onerror = () => {
        img.remove();
        inner.appendChild(svgUse(ICONS.music));
      };
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
    const badge = el("span", "sp-badge", "SP");
    badge.title = "Открывается на Spotify";
    cover.appendChild(badge);
    card.appendChild(cover);
    card.appendChild(el("div", "card-title", title));
    card.appendChild(el("div", "card-sub", sub));
    card.addEventListener("click", onOpen);
    return card;
  }

  function cloudExtras() {
    const frag = document.createDocumentFragment();
    frag.appendChild(statusBar());

    if (state.spotify.loading) {
      const spin = el("div", "spinner-wrap");
      const s = el("div", "spinner");
      spin.appendChild(s);
      spin.appendChild(el("span", null, "Ищу в Spotify…"));
      frag.appendChild(spin);
      return frag;
    }

    if (state.spotify.error === "auth") {
      const hint = el("p", "sp-hint", "Чтобы вперемешку с архивом искать треки Spotify: вставьте Client ID и войдите.");
      frag.appendChild(hint);
      return frag;
    }
    if (state.spotify.error) {
      const hint = el("p", "sp-hint", "Spotify: " + state.spotify.error);
      frag.appendChild(hint);
      return frag;
    }

    const res = state.spotify.results;
    if (!res || !state.spotify.query) return frag;

    if (res.trackIds.length) {
      const sec = makeSection("Spotify · Треки", "сброс", clearSpotifyResults);
      sec.appendChild(makeTrackList(res.trackIds));
      frag.appendChild(sec);
    }
    if (res.artists.length) {
      const sec = makeSection("Spotify · Исполнители", null, null);
      const grid = el("div", "grid");
      for (const a of res.artists) {
        grid.appendChild(metaCard({
          title: a.name,
          sub: "Исполнитель",
          coverUrl: a.images && a.images.length ? a.images[0].url : "",
          onOpen: () => navigate("spotify-artist", { id: a.id, name: a.name, images: a.images || [] }),
        }));
      }
      sec.appendChild(grid);
      frag.appendChild(sec);
    }
    if (res.albums.length) {
      const sec = makeSection("Spotify · Альбомы", null, null);
      const grid = el("div", "grid");
      for (const a of res.albums) {
        grid.appendChild(metaCard({
          title: a.name,
          sub: artistsNames(a.artists),
          coverUrl: a.images && a.images.length ? a.images[0].url : "",
          onOpen: () => navigate("spotify-album", { id: a.id, name: a.name, images: a.images || [], artists: a.artists || [] }),
        }));
      }
      sec.appendChild(grid);
      frag.appendChild(sec);
    }
    if (res.playlists.length) {
      const sec = makeSection("Spotify · Плейлисты", null, null);
      const grid = el("div", "grid");
      for (const p of res.playlists) {
        grid.appendChild(metaCard({
          title: p.name,
          sub: (p.owner && p.owner.display_name) || "Плейлист",
          coverUrl: p.images && p.images.length ? p.images[0].url : "",
          onOpen: () => navigate("spotify-playlist", { id: p.id, name: p.name, images: p.images || [] }),
        }));
      }
      sec.appendChild(grid);
      frag.appendChild(sec);
    }
    if (!res.trackIds.length && !res.artists.length && !res.albums.length && !res.playlists.length) {
      frag.appendChild(makeEmptyState({
        icon: ICONS.search,
        title: "В Spotify такого не нашлось",
        text: "Spotify ищет по трекам, альбомам, исполнителям и плейлистам — попробуйте другое слово.",
      }));
    }
    return frag;
  }

  function clearSpotifyResults() {
    state.spotify.query = "";
    state.spotify.results = null;
    render();
  }

  /* ================= Виды: альбом / исполнитель / плейлист ================= */

  async function viewWrapper(fn) {
    viewEl.appendChild(makeViewBack());
    try {
      await fn();
    } catch (e) {
      console.warn("Spotify: страница не открылась", e);
      viewEl.appendChild(makeEmptyState({
        icon: ICONS.search,
        title: "Не удалось открыть страницу Spotify",
        text: (e && e.message) || "Попробуйте ещё раз.",
        actionLabel: "Вернуться",
        actionFn: () => navigate("cloud"),
      }));
    }
  }

  const views = {
    "spotify-album": () => {
      const base = state.viewData;
      if (!base || !base.id) {
        navigate("cloud");
        return;
      }
      viewWrapper(async () => {
        let album = state.spAlbumCache.get(base.id);
        if (!album) {
          album = await api("/albums/" + encodeURIComponent(base.id));
          state.spAlbumCache.set(base.id, album);
        }
        viewEl.appendChild(buildHero(
          "Альбом Spotify",
          album.name || base.name || "Альбом",
          artistsNames(album.artists || base.artists) +
            (album.total_tracks ? " · " + album.total_tracks + " трек(ов)" : ""),
          (album.images && album.images[0] && album.images[0].url) || ""
        ));
        const ids = [];
        for (const item of (album.tracks && album.tracks.items) || []) {
          if (item && item.id) ids.push(registerSpotifyTrack(item));
        }
        saveSpotifyTracks();
        if (ids.length) {
          const sec = makeSection("Треки альбома");
          sec.appendChild(makeTrackList(ids));
          viewEl.appendChild(sec);
          const hint = el("p", "sp-hint", "Аудио Spotify в Web API не отдаётся — при выборе трека откроется его страница на Spotify.");
          viewEl.appendChild(hint);
        } else {
          viewEl.appendChild(makeEmptyState({ icon: ICONS.music, title: "Треков не нашлось", text: "Возможно, альбом скрыт в вашем регионе." }));
        }
      });
    },

    "spotify-artist": () => {
      const base = state.viewData;
      if (!base || !base.id) {
        navigate("cloud");
        return;
      }
      viewWrapper(async () => {
        const artist = await api("/artists/" + encodeURIComponent(base.id));
        const [top, albums] = await Promise.all([
          api("/artists/" + encodeURIComponent(base.id) + "/top-tracks"),
          api("/artists/" + encodeURIComponent(base.id) + "/albums", { limit: "12" }),
        ]);
        const cover = (artist.images && artist.images[0] && artist.images[0].url) || "";
        viewEl.appendChild(buildHero(
          "Исполнитель Spotify",
          artist.name || base.name || "Исполнитель",
          (artist.genres && artist.genres.length ? artist.genres.slice(0, 3).join(" · ") : "Исполнитель") +
            (albums.items ? " · альбомов: " + albums.items.length : ""),
          cover
        ));
        const topIds = [];
        for (const t of top.tracks || []) {
          if (t && t.id) topIds.push(registerSpotifyTrack(t));
        }
        saveSpotifyTracks();
        if (topIds.length) {
          const sec = makeSection("Популярные треки");
          sec.appendChild(makeTrackList(topIds.slice(0, 10)));
          viewEl.appendChild(sec);
        }
        if (albums.items && albums.items.length) {
          const sec = makeSection("Альбомы", null, null);
          const grid = el("div", "grid");
          for (const a of albums.items) {
            grid.appendChild(metaCard({
              title: a.name,
              sub: a.release_date ? String(a.release_date).slice(0, 4) : "Альбом",
              coverUrl: a.images && a.images.length ? a.images[0].url : "",
              onOpen: () => navigate("spotify-album", { id: a.id, name: a.name, images: a.images || [], artists: artist ? [artist] : [] }),
            }));
          }
          sec.appendChild(grid);
          viewEl.appendChild(sec);
        }
      });
    },

    "spotify-playlist": () => {
      const base = state.viewData;
      if (!base || !base.id) {
        navigate("cloud");
        return;
      }
      viewWrapper(async () => {
        const pl = await api("/playlists/" + encodeURIComponent(base.id));
        const cover = (pl.images && pl.images[0] && pl.images[0].url) || "";
        viewEl.appendChild(buildHero(
          "Плейлист Spotify",
          pl.name || base.name || "Плейлист",
          (pl.tracks && pl.tracks.total ? pl.tracks.total + " трек(ов) · " : "") +
            (pl.owner && pl.owner.display_name ? "автор: " + pl.owner.display_name : ""),
          cover
        ));
        const ids = [];
        for (const item of (pl.tracks && pl.tracks.items) || []) {
          const t = item && item.track;
          if (t && t.id && t.type === "track") ids.push(registerSpotifyTrack(t));
        }
        saveSpotifyTracks();
        if (ids.length) {
          const sec = makeSection("Треки плейлиста");
          sec.appendChild(makeTrackList(ids));
          viewEl.appendChild(sec);
        } else {
          viewEl.appendChild(makeEmptyState({ icon: ICONS.playlist, title: "Треков не нашлось", text: "Плейлист пуст или скрыт владельцем." }));
        }
      });
    },
  };

  /* ================= Экспорт на window ================= */

  window.SpotifyViews = {
    statusBar,
    cloudExtras,
    cloudHook,
    views,
    onTrackDeleted,
    isConnected,
    searchAll,
    login,
    logout,
  };

  /* Загружаем сохранённые Spotify-треки (избранное/плейлисты с ними работают) */
  loadSpotifyTracks();
})();
