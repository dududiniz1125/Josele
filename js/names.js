// Player-name rules for Josele, shared by the browser, the tests and the
// database script (scripts/build-sql.js copies these lists into supabase/setup.sql).
(function (root) {
  'use strict';

  var MAX_LENGTH = 15;
  // Letters (including Portuguese accents), digits and spaces.
  var ALLOWED = '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 ]+$';

  // Folding used only for the bad-word check: strip accents, undo simple "leet" digits.
  var FOLD_FROM = 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ0134578';
  var FOLD_TO = 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnoieastb';

  // Blocked wherever they appear (spaces ignored), English + Portuguese.
  var BLOCK_ANYWHERE = [
    'fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'pussy', 'asshole',
    'bastard', 'nazi', 'hitler', 'penis', 'vagina', 'porn', 'retard', 'wank', 'rapist',
    'caralho', 'karalho', 'porra', 'buceta', 'boceta', 'xoxota', 'viado', 'merda', 'bosta',
    'cuzao', 'foda', 'fode', 'fudid', 'piroca', 'punheta', 'arrombad', 'vagabund',
    'desgraca', 'otario', 'babaca', 'vadia', 'estupr'
  ];
  // Blocked only as a whole word, so names like "Cassio" or "Paulo" still work.
  var BLOCK_WORD = [
    'ass', 'sex', 'sexo', 'cock', 'dick', 'fag', 'rape', 'twat', 'prick', 'tits', 'boobs',
    'anal', 'anus', 'cum', 'kkk', 'hoe',
    'cu', 'pau', 'puta', 'putas', 'puto', 'bicha', 'corno', 'fdp', 'vsf', 'pqp', 'crl', 'krl'
  ];

  function clean(raw) {
    return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  }

  function fold(name) {
    var out = '';
    for (var i = 0; i < name.length; i++) {
      var k = FOLD_FROM.indexOf(name[i]);
      out += k === -1 ? name[i] : FOLD_TO[k];
    }
    return out.toLowerCase();
  }

  function isOffensive(name) {
    var folded = fold(name);
    var squashed = folded.replace(/[ _]/g, '');
    var words = folded.replace(/_/g, ' ').split(' ');
    return BLOCK_ANYWHERE.some(function (b) { return squashed.indexOf(b) !== -1; }) ||
      BLOCK_WORD.some(function (b) { return words.indexOf(b) !== -1; });
  }

  // Returns { ok: true, name } or { ok: false, reason }.
  function validate(raw) {
    var name = clean(raw);
    if (!name) return { ok: false, reason: 'Please type a name' };
    if (name.length > MAX_LENGTH) return { ok: false, reason: 'Max ' + MAX_LENGTH + ' characters' };
    if (!new RegExp(ALLOWED).test(name)) return { ok: false, reason: 'Letters, numbers and spaces only' };
    if (isOffensive(name)) return { ok: false, reason: 'Please pick another name' };
    return { ok: true, name: name };
  }

  // Account usernames: no spaces, and "Mari" and "mari" count as the same one.
  var USERNAME_MIN = 3;
  var USERNAME_ALLOWED = '^[A-Za-z0-9_]+$';
  var PASSWORD_MIN = 6;

  function validateUsername(raw) {
    var u = String(raw == null ? '' : raw).trim();
    if (u.length < USERNAME_MIN || u.length > MAX_LENGTH) {
      return { ok: false, reason: 'Username must be ' + USERNAME_MIN + ' to ' + MAX_LENGTH + ' characters' };
    }
    if (!new RegExp(USERNAME_ALLOWED).test(u)) return { ok: false, reason: 'Username: letters, numbers and _ only' };
    if (isOffensive(u)) return { ok: false, reason: 'Please pick another username' };
    return { ok: true, username: u };
  }

  function validatePassword(raw) {
    var p = String(raw == null ? '' : raw);
    if (p.length < PASSWORD_MIN) return { ok: false, reason: 'Password must be at least ' + PASSWORD_MIN + ' characters' };
    if (p.length > 72) return { ok: false, reason: 'Password is too long' };
    return { ok: true };
  }

  var api = {
    USERNAME_MIN: USERNAME_MIN, USERNAME_ALLOWED: USERNAME_ALLOWED, PASSWORD_MIN: PASSWORD_MIN,
    validateUsername: validateUsername, validatePassword: validatePassword,
    MAX_LENGTH: MAX_LENGTH, ALLOWED: ALLOWED, FOLD_FROM: FOLD_FROM, FOLD_TO: FOLD_TO,
    BLOCK_ANYWHERE: BLOCK_ANYWHERE, BLOCK_WORD: BLOCK_WORD,
    clean: clean, fold: fold, isOffensive: isOffensive, validate: validate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JoseleNames = api;
})(typeof self !== 'undefined' ? self : this);
