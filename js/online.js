// Josele online layer: talks to the database functions in supabase/setup.sql.
// No DOM code here. If js/config.js is empty the game simply runs offline.
//
// Every browser gets an invisible anonymous Supabase session. That session is
// linked on the server to a player: a guest, or (after "Log in") an account
// with a username and password.
(function () {
  'use strict';

  var cfg = window.JOSELE_CONFIG || {};
  var enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  var client = null;
  var signedIn = false;   // this browser has a session
  var profile = null;     // last profile from the server
  var hooks = {};
  var queue = Promise.resolve();

  async function rpc(fn, args) {
    var r = await client.rpc(fn, args || {});
    if (r.error) throw new Error(r.error.message || 'Request failed');
    return r.data;
  }

  async function ensureSession(force) {
    var session = (await client.auth.getSession()).data.session;
    if (!session && force) {
      var res = await client.auth.signInAnonymously();
      if (res.error) throw res.error;
      session = res.data.session;
    }
    signedIn = !!session;
    return signedIn;
  }

  // Brings the server in line with this device: session, name, today's result.
  async function doSync() {
    var name = hooks.getName();
    // Guests only get a session once they have a name; nothing to store before that.
    if (!(await ensureSession(!!name))) return;

    var p = await rpc('my_profile');
    if (name && (!p.name || (p.guest && p.name !== name))) {
      p.name = await rpc('set_name', { p_name: name });
    }
    var game = hooks.getGame();
    if (p.name && game.done && game.day === p.today && !p.today_path) {
      try {
        await rpc('submit_result', { p_day: game.day, p_path: game.rows });
        p = await rpc('my_profile');
      } catch (e) {
        hooks.onError('Result not saved: ' + e.message);
      }
    }
    profile = p;
    hooks.onProfile(p);
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
    return sync();
  }

  async function setName(name) {
    if (!enabled || !signedIn) return name;
    return rpc('set_name', { p_name: name });
  }

  // Create an account for whoever is playing on this device (their progress comes along).
  async function signUp(name, username, password) {
    await ensureSession(true);
    profile = await rpc('sign_up', { p_name: name, p_username: username, p_password: password });
    hooks.onProfile(profile);
    return sync();
  }

  async function logIn(username, password) {
    await ensureSession(true);
    var p = await rpc('log_in', { p_username: username, p_password: password });
    if (p && p.error) throw new Error(p.error);
    profile = p;
    hooks.onProfile(p);
    return sync();
  }

  async function logOut() {
    if (signedIn) await rpc('log_out');
    profile = null;
  }

  function leaderboard(kind) {
    return rpc(kind === 'streaks' ? 'leaderboard_streaks' : 'leaderboard_today');
  }

  window.JoseleOnline = {
    enabled: enabled,
    init: init,
    sync: sync,
    // The logged-in account ({ name, username, ... }) or null for a guest.
    account: function () { return profile && profile.username ? profile : null; },
    setName: setName,
    signUp: signUp,
    logIn: logIn,
    logOut: logOut,
    leaderboard: leaderboard
  };
})();
