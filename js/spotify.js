/* ==========================================================
   Limurane · Spotify (официальный Web API, OAuth 2.0 + PKCE)
   Поиск и метаданные — Web API. Звук — только официальные
   инструменты Spotify: Embed-плеер (iframe). Никакого Client
   Secret, никаких неофициальных методов получения аудио.
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
  const LS_RECENT = "limurane.spotify.recent";

  const API = "https://api.spotify.com/v1";
  const AUTH_URL = "https://accounts.spotify.com/authorize";
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const SEARCH_LIMIT = 6; /* у dev-приложений лимите lowered — не просим больше */

  /* --- Рабочее состояние секций Spotify --- */
  state.spotify = state.spotify || {
    query: "",
    results: null, /* {trackIds, artists, albums, playlists} */
    loading: false,
    error: null,
    lastUnified: "", /* последний запрос общего поиска */
    embed: null, /* открытый Embed-оверлей */
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

  function spId(raw) {
    return "s" + raw;
  }
  function rawId(id) {
    return String(id || "").replace(/^s/, "");
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

  /* ================= Поиск (используется везде) ================= */

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

  /* Общий поиск Limurane (топ-бар): отложенный запрос, чтобы не дёргать
     API на каждом символе */
  let unifyTimer = null;
  function onUnifiedQuery(q) {
    const text = (q || "").trim();
    clearTimeout(unifyTimer);
    if (!text) {
      state.spotify.lastUnified = "";
      if (state.spotify.results) {
        state.spotify.query = "";
        state.spotify.results = null;
        state.spotify.error = null;
      }
      return;
    }
    if (text === state.spotify.lastUnified) return; /* перерисовка после ответа */
    unifyTimer = setTimeout(async () => {
      const current = (state.query || "").trim();
      if (!current || text !== current) return; /* пользователь уже стёр/передумал */
      state.spotify.lastUnified = current;
      await searchAll(current);
    }, 600);
  }

  /* ================= UI: общие куски ================= */

  function spSpinner(text) {
    const spin = el("div", "spinner-wrap");
    const s = el("div", "spinner");
    spin.appendChild(s);
    spin.appendChild(el("span", null, text || "Ищу в Spotify…"));
    return spin;
  }

  function statusBar() {
    const wrap = el("div", "sp-status");
    wrap.appendChild(el("div", "sp-label", "Spotify — официальное API. Вставьте Client ID приложения (dashboard → Web API + Web Playback SDK + Embeds), затем войдите."));
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

  function resultsInto(container) {
    const res = state.spotify.results;
    if (!res) return;
    if (res.trackIds.length) {
      const sec = makeSection("Spotify · Треки", "сброс", clearSpotifyResults);
      sec.appendChild(makeTrackList(res.trackIds));
      container.appendChild(sec);
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
      container.appendChild(sec);
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
      container.appendChild(sec);
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
      container.appendChild(sec);
    }
    if (!res.trackIds.length && !res.artists.length && !res.albums.length && !res.playlists.length) {
      container.appendChild(makeEmptyState({
        icon: ICONS.search,
        title: "В Spotify такого не нашлось",
        text: "Spotify ищет по трекам, альбомам, исполнителям и плейлистам — попробуйте другое слово.",
      }));
    }
  }

  function errorHintInto(container) {
    if (state.spotify.error === "auth") {
      container.appendChild(el("p", "sp-hint", "Чтобы искать каталог Spotify, вставьте Client ID и войдите — бесплатно и только для вашего аккаунта."));
    } else if (state.spotify.error) {
      container.appendChild(el("p", "sp-hint", "Spotify: " + state.spotify.error));
    }
  }

  function clearSpotifyResults() {
    state.spotify.query = "";
    state.spotify.results = null;
    state.spotify.loading = false;
    state.spotify.error = null;
    render();
  }

  /* ================= Вкладка «Облако»: строка входа + результаты ================= */

  function cloudExtras() {
    const frag = document.createDocumentFragment();
    frag.appendChild(statusBar());
    if (state.spotify.loading) {
      frag.appendChild(spSpinner());
      return frag;
    }
    if (state.spotify.error) {
      errorHintInto(frag);
      return frag;
    }
    if (state.spotify.results && state.spotify.query) resultsInto(frag);
    return frag;
  }

  /* ================= Монтирование в общий поиск ================= */

  function searchMount() {
    const mount = document.createElement("div");
    mount.id = "spUnifiedMount";
    if (state.spotify.loading) {
      mount.appendChild(spSpinner());
      return mount;
    }
    if (state.spotify.error && state.spotify.error !== "auth") {
      mount.appendChild(el("p", "sp-hint", "Spotify: " + state.spotify.error));
      return mount;
    }
    if (state.spotify.results && state.spotify.query === (state.query || "").trim()) {
      const sec0 = el("div", "sp-mount-head");
      sec0.appendChild(el("div", "hero-kicker", "каталог Spotify"));
      mount.appendChild(sec0);
      resultsInto(mount);
    }
    return mount;
  }

  /* ================= Embed-плеер (официальный) ================= */

  function openEmbed(track) {
    if (!track || track.source !== "spotify" || !track.id) return;
    pushRecent(track.id);
    /* локальный плеер молчит, пока играет Embed */
    if (typeof audio !== "undefined" && audio && !audio.paused) audio.pause();
    closeEmbed();

    const ov = el("div", "embed-overlay");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Плеер Spotify");

    const card = el("div", "embed-card");
    const bar = el("div", "embed-bar");
    bar.appendChild(el("span", "embed-title", `${track.title} · ${track.artist}`));
    const close = el("button", "embed-close", "✕");
    close.setAttribute("aria-label", "Закрыть плеер Spotify");
    close.addEventListener("click", closeEmbed);
    bar.appendChild(close);
    card.appendChild(bar);

    const frame = document.createElement("iframe");
    frame.title = "Spotify: " + (track.title || "трек");
    frame.src = "https://open.spotify.com/embed/track/" + encodeURIComponent(rawId(track.id)) + "?utm_source=limurane&theme=0";
    frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
    frame.loading = "lazy";
    frame.setAttribute("allowfullscreen", "");
    card.appendChild(frame);

    const note = el("p", "embed-note", "Официальный плеер Spotify Embed: без аккаунта звучит фрагмент, с Premium-входом внутри фрейма — трек целиком.");
    card.appendChild(note);

    ov.appendChild(card);
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeEmbed();
    });
    document.body.appendChild(ov);
    state.spotify.embed = ov;
  }

  function closeEmbed() {
    const ov = state.spotify.embed;
    if (ov && typeof ov.remove === "function") ov.remove();
    state.spotify.embed = null;
  }

  /* ================= Виды ================= */

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
        actionFn: () => navigate("spotify"),
      }));
    }
  }

  /* Домашняя страница Spotify (в боковом меню) */
  function viewSpotifyHome() {
    const hero = el("div", "hero");
    const coverWrap = el("div", "hero-placeholder big");
    const spMark = el("div", "sp-mark");
    coverWrap.appendChild(spMark);
    hero.appendChild(coverWrap);
    const text = el("div", "hero-text");
    text.appendChild(el("div", "hero-kicker", "Каталог"));
    text.appendChild(el("h1", "hero-title", "Spotify"));
    text.appendChild(el("div", "hero-meta"));
    $(".hero-meta", text).append(document.createTextNode(
      isConnected() ? "Поиск по всему каталогу · воспроизведение через официальный Embed" : "Поиск по каталогу · войдите, чтобы искать"
    ));
    hero.appendChild(text);
    viewEl.appendChild(hero);

    viewEl.appendChild(statusBar());

    /* Собственный поиск Spotify */
    const form = el("form", "cloud-search");
    form.setAttribute("role", "search");
    const input = el("input");
    input.type = "search";
    input.placeholder = "Поиск в Spotify: трек, альбом, исполнитель…";
    input.value = state.spotify.query || "";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Поиск в Spotify");
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

    /* Жанровые подборки (поиск по каталогу) */
    const chips = el("div", "cloud-chips");
    SP_GENRES.forEach((g) => {
      const chip = el("button", "chip", g.label);
      chip.addEventListener("click", () => searchAll(g.q));
      chips.appendChild(chip);
    });
    viewEl.appendChild(chips);

    if (state.spotify.loading) {
      viewEl.appendChild(spSpinner());
      return;
    }
    if (state.spotify.error) {
      errorHintInto(viewEl);
    }
    if (state.spotify.results && state.spotify.query) {
      resultsInto(viewEl);
      return;
    }

    /* Недавно открывавшиеся Spotify-треки */
    const recent = loadRecent().filter((id) => state.tracks.has(id) && state.tracks.get(id).source === "spotify");
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

  /* Страница трека */
  function viewSpotifyTrack() {
    const base = state.viewData && typeof state.viewData === "object" ? state.viewData : { id: state.viewData };
    if (!base.id) {
      navigate("spotify");
      return;
    }
    viewWrapper(async () => {
      const t = await api("/tracks/" + encodeURIComponent(rawId(base.id)));
      const entry = entryFromSpotify(t);
      registerEntry(entry);
      saveSpotifyTracks();
      pushRecent(entry.id);

      viewEl.appendChild(buildHero(
        "Трек Spotify",
        entry.title,
        entry.artist + (entry.duration ? " · " + fmtTime(entry.duration) : ""),
        entry.coverUrl
      ));

      const actions = el("div", "hero-actions");
      const listenBtn = el("button", "btn primary", "▶ Слушать");
      listenBtn.setAttribute("aria-label", "Слушать трек через Spotify Embed");
      listenBtn.addEventListener("click", () => openEmbed(entry));
      actions.appendChild(listenBtn);

      const favBtn = el("button", "btn ghost", state.favorites.includes(entry.id) ? "♥ В избранном" : "♡ В избранное");
      favBtn.addEventListener("click", () => {
        toggleFavorite(entry.id);
        favBtn.textContent = state.favorites.includes(entry.id) ? "♥ В избранном" : "♡ В избранное";
      });
      actions.appendChild(favBtn);
      viewEl.appendChild(actions);

      if (t.album && t.album.id) {
        const albBtn = el("button", "btn ghost", "Альбом: " + t.album.name);
        albBtn.addEventListener("click", () => navigate("spotify-album", {
          id: t.album.id,
          name: t.album.name,
          images: t.album.images || [],
          artists: t.album.artists || [],
        }));
        viewEl.appendChild(albBtn);
      }

      if (entry.url) {
        const openBtn = el("button", "btn ghost", "Открыть на Spotify ↗");
        openBtn.addEventListener("click", () => window.open(entry.url, "_blank", "noopener"));
        viewEl.appendChild(openBtn);
      }
    });
  }

  /* Страница альбома */
  function viewSpotifyAlbum() {
    const base = state.viewData;
    if (!base || !base.id) {
      navigate("spotify");
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
          (album.total_tracks ? " · " + album.total_tracks + " трек(ов)" : "") +
          (album.release_date ? " · " + String(album.release_date).slice(0, 4) : ""),
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
        const hint = el("p", "sp-hint", "Выберите трек — он откроется в официальном Embed-плеере прямо в Limurane.");
        viewEl.appendChild(hint);
      } else {
        viewEl.appendChild(makeEmptyState({ icon: ICONS.music, title: "Треков не нашлось", text: "Возможно, альбом скрыт в вашем регионе." }));
      }
    });
  }

  /* Страница исполнителя */
  function viewSpotifyArtist() {
    const base = state.viewData;
    if (!base || !base.id) {
      navigate("spotify");
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
          (artist.followers && artist.followers.total ? " · подписчиков: " + artist.followers.total.toLocaleString("ru-RU") : ""),
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
            onOpen: () => navigate("spotify-album", { id: a.id, name: a.name, images: a.images || [], artists: artist ? [{ name: artist.name }] : [] }),
          }));
        }
        sec.appendChild(grid);
        viewEl.appendChild(sec);
      }
    });
  }

  /* Страница плейлиста */
  function viewSpotifyPlaylist() {
    const base = state.viewData;
    if (!base || !base.id) {
      navigate("spotify");
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
  }

  const SP_GENRES = [
    { label: "Поп", q: 'genre:"pop"' },
    { label: "Рок", q: 'genre:"rock"' },
    { label: "Электроника", q: 'genre:"electronic"' },
    { label: "Хип-хоп", q: 'genre:"hip-hop"' },
    { label: "Инди", q: 'genre:"indie"' },
    { label: "Джаз", q: 'genre:"jazz"' },
  ];

  const views = {
    spotify: viewSpotifyHome,
    "spotify-track": viewSpotifyTrack,
    "spotify-album": viewSpotifyAlbum,
    "spotify-artist": viewSpotifyArtist,
    "spotify-playlist": viewSpotifyPlaylist,
  };

  /* ================= Экспорт на window ================= */

  window.SpotifyViews = {
    statusBar,
    cloudExtras,
    cloudHook,
    searchMount,
    onUnifiedQuery,
    openEmbed,
    closeEmbed,
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
