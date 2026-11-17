// Josele online layer: Supabase auth + the database functions in supabase/setup.sql.
// No DOM code here. If js/config.js is empty the game simply runs offline.
(function () {
  'use strict';

  var TOKEN_KEY = 'josele-merge-token';
  var cfg = window.JOSELE_CONFIG || {};
  var enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  var client = null;
  var user = null;      // { id, isAnonymous, email }
  var hooks = {};
  var queue = Promise.resolve();

  function siteUrl() { return location.origin + location.pathname; }

  async function rpc(fn, args) {
    var r = await client.rpc(fn, args || {});
    if (r.error) throw new Error(r.error.message || 'Request failed');
    return r.data;
  }

  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function store(key, value) {
    try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  // Brings the server in line with this device: session, name, guest progress, today's result.
  async function doSync() {
    var name = hooks.getName();
    var session = (await client.auth.getSession()).data.session;
    if (!session) {
      if (!name) return;            // wait until the player has chosen a name
      var res = await client.auth.signInAnonymously();
      if (res.error) throw res.error;
      session = res.data.session;
    }
    user = { id: session.user.id, isAnonymous: !!session.user.is_anonymous, email: session.user.email || '' };

    // Just logged in on a device that had guest progress: move it to the account.
    var token = stored(TOKEN_KEY);
    if (token && !user.isAnonymous) {
      try { await rpc('claim_guest', { p_token: token }); } catch (e) { console.warn('Josele: merge failed', e); }
      store(TOKEN_KEY, null);
    }

    var profile = await rpc('my_profile');
    if (name && (!profile.name || (user.isAnonymous && profile.name !== name))) {
      profile.name = await rpc('set_name', { p_name: name });
    }

    var game = hooks.getGame();
    if (profile.name && game.done && game.day === profile.today && !profile.today_path) {
      try {
        await rpc('submit_result', { p_day: game.day, p_path: game.rows });
        profile = await rpc('my_profile');
      } catch (e) {
        hooks.onError('Result not saved: ' + e.message);
      }
    }
    hooks.onProfile(profile, user);
  }

  function sync() {
    if (!enabled) return Promise.resolve();
    queue = queue.then(doSync).catch(function (e) { console.warn('Josele: sync failed', e); });
    return queue;
  }

  function init(h) {
    hooks = h;
    if (!enabled) return Promise.resolve();
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    client.auth.onAuthStateChange(function (event, session) {
      var id = session && session.user ? session.user.id : null;
      if (event === 'SIGNED_OUT') user = null;
      // Another tab finished logging in (magic link): pick up the new account here too.
      if (event === 'SIGNED_IN' && id !== (user && user.id)) setTimeout(sync, 0);
    });
    return sync();
  }

  // Remember which guest we are, so progress can follow us into the account.
  async function prepareMerge() {
    if (!user || !user.isAnonymous) return;
    try {
      var token = await rpc('create_merge_token');
      if (token) store(TOKEN_KEY, token);
    } catch (e) { console.warn('Josele: could not prepare merge', e); }
  }

  async function loginGoogle() {
    await prepareMerge();
    var r = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: siteUrl() } });
    if (r.error) throw r.error;
  }

  async function loginEmail(email) {
    await prepareMerge();
    var r = await client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: siteUrl() } });
    if (r.error) throw r.error;
  }

  async function logout() {
    store(TOKEN_KEY, null);
    await client.auth.signOut();
    user = null;
  }

  async function setName(name) {
    if (!enabled || !user) return name;
    return rpc('set_name', { p_name: name });
  }

  // Which login methods the Supabase project has switched on: { google, email }.
  var providersPromise = null;
  function providers() {
    if (!enabled) return Promise.resolve({ google: false, email: false });
    if (!providersPromise) {
      providersPromise = fetch(cfg.SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: cfg.SUPABASE_ANON_KEY } })
        .then(function (r) { return r.json(); })
        .then(function (d) { var e = d.external || {}; return { google: !!e.google, email: !!e.email }; })
        .catch(function () { providersPromise = null; return { google: true, email: true }; });
    }
    return providersPromise;
  }

  function leaderboard(kind) {
    return rpc(kind === 'streaks' ? 'leaderboard_streaks' : 'leaderboard_today');
  }

  window.JoseleOnline = {
    enabled: enabled,
    init: init,
    sync: sync,
    user: function () { return user; },
    setName: setName,
    leaderboard: leaderboard,
    providers: providers,
    loginGoogle: loginGoogle,
    loginEmail: loginEmail,
    logout: logout
  };
})();
