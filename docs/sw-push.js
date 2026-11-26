/* Makeline Trainer: push and notification-click handling for the service worker.
 *
 * Classic script (no ES modules) so it works in every Safari service worker.
 * sw.js loads it with importScripts(); the unit tests load it in a sandbox.
 *
 * Golden rule: Safari takes away notification permission if a push arrives and no
 * notification is shown, so handlePush() ALWAYS shows one, whatever goes wrong.
 *
 * The push payload carries no build data. It's a Declarative Web Push message:
 *   { "web_push": 8030, "notification": { title, body, navigate, tag, data: { type } }, "mutable": true }
 * On iOS 18.4+ the system parses it and fires `push` with event.notification set and
 * event.data null; if we fail, iOS shows the declared fallback. Older iOS (and other
 * browsers) deliver it as plain push data, which we parse ourselves.
 * The actual question comes from the snapshot the app saved on this device.
 */
(function (root) {
  'use strict';

  var C = {
    DB_NAME: 'makeline',
    DB_VERSION: 1,
    STORE: 'kv',
    SNAPSHOT_KEY: 'notify',
    DATA_CACHE: 'makeline-data-v1',
    SNAPSHOT_URL: '__notify.json',
    READ_TIMEOUT_MS: 2500,
  };

  var FALLBACK = { title: 'Makeline', body: '🍕 Quiz time, tap to practise', url: './#/quiz/due', tag: 'quiz' };
  var NO_DATA = { title: 'Makeline', body: 'Open Makeline to load your builds', url: './#/load', tag: 'quiz' };

  function dayIndex(date) {
    return Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  }

  /** Same rule as srs.computeStreak: today counts if active, else yesterday's run is still alive. */
  function streakFrom(activeDays, today) {
    var set = {};
    (activeDays || []).forEach(function (d) { set[d] = true; });
    var d = set[today] ? today : today - 1;
    var n = 0;
    while (set[d]) { n++; d--; }
    return n;
  }

  function dueOn(snapshot, today) {
    var map = (snapshot && snapshot.dueByDay) || {};
    if (typeof map[today] === 'number') return map[today];
    // Past the precomputed range: use the last known day (counts only grow).
    var best = null;
    Object.keys(map).forEach(function (k) {
      var d = Number(k);
      if (d <= today && (best === null || d > best)) best = d;
    });
    return best === null ? 0 : map[best];
  }

  /** What kind of push is this? Defaults to a quiz question. */
  function pushType(event) {
    try {
      if (event && event.notification && event.notification.data && event.notification.data.type) {
        return String(event.notification.data.type);
      }
    } catch (e) { /* ignore */ }
    try {
      if (event && event.data) {
        var obj = event.data.json();
        if (obj && obj.notification && obj.notification.data && obj.notification.data.type) return String(obj.notification.data.type);
        if (obj && obj.type) return String(obj.type);
      }
    } catch (e) { /* not JSON: still a quiz */ }
    return 'quiz';
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
      Promise.resolve(promise).then(
        function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(t); resolve(null); } }
      );
    });
  }

  function options(n) {
    return { body: n.body, tag: n.tag, renotify: true, lang: 'en-GB', data: { url: n.url, key: n.key || null, type: n.type || 'quiz' } };
  }

  /** The next question from the snapshot, or null. Returns { n, snapshot } with the pointer advanced. */
  function nextQuiz(snapshot, today) {
    if (!snapshot || !snapshot.hasData || !Array.isArray(snapshot.entries) || !snapshot.entries.length) return null;
    var i = typeof snapshot.next === 'number' && snapshot.next >= 0 ? snapshot.next : 0;
    if (i >= snapshot.entries.length) i = 0; // ran out: start again rather than show nothing
    var e = snapshot.entries[i];
    if (!e || !e.key || !e.title || !e.body) return null;
    var updated = Object.assign({}, snapshot, { next: i + 1, sent: (snapshot.sent || []).concat([{ key: e.key, day: today }]).slice(-30) });
    return {
      n: { title: e.title, body: e.body, tag: 'quiz', type: 'quiz', key: e.key, url: './#/q/' + encodeURIComponent(e.key) },
      snapshot: updated,
    };
  }

  function summaryText(snapshot, today) {
    var due = dueOn(snapshot, today);
    var streak = streakFrom(snapshot && snapshot.activeDays, today);
    var minutes = Math.max(1, Math.min(15, Math.round((due * 8) / 60)));
    var parts = [];
    parts.push(due > 0 ? due + ' due today' : 'Nothing due today');
    if (streak > 0) parts.push('🔥 ' + streak + '-day streak');
    var ask = due > 0 ? minutes + (minutes === 1 ? ' minute?' : ' minutes?') : 'Fancy a quick round?';
    return { title: 'Makeline', body: parts.join(' · ') + '. ' + ask, tag: 'summary', type: 'summary', url: './#/quiz/due' };
  }

  /**
   * Handle a push. deps = { registration, readSnapshot(), writeSnapshot(s), setBadge(n), now() }.
   * Resolves once a notification has been shown (or every attempt failed).
   */
  function handlePush(event, deps) {
    var reg = deps.registration;
    var shown = false;
    function show(n) {
      return Promise.resolve(reg.showNotification(n.title, options(n))).then(function () { shown = true; });
    }
    var work = Promise.resolve().then(function () {
      var type = pushType(event);
      var now = deps.now ? deps.now() : new Date();
      var today = dayIndex(now);
      return withTimeout(deps.readSnapshot ? deps.readSnapshot() : null, C.READ_TIMEOUT_MS).then(function (snapshot) {
        var n = null;
        var next = null;
        if (!snapshot || !snapshot.hasData) {
          n = NO_DATA;
        } else if (type === 'summary') {
          n = summaryText(snapshot, today);
        } else {
          var picked = nextQuiz(snapshot, today);
          if (picked) { n = picked.n; next = picked.snapshot; }
        }
        if (!n) n = FALLBACK;
        return show(n).then(function () {
          var tasks = [];
          if (next && deps.writeSnapshot) tasks.push(withTimeout(deps.writeSnapshot(next), C.READ_TIMEOUT_MS));
          if (snapshot && snapshot.hasData && deps.setBadge) tasks.push(withTimeout(deps.setBadge(dueOn(snapshot, today)), 1000));
          return Promise.all(tasks);
        });
      });
    });
    return work.catch(function () { /* fall through to the fallback below */ }).then(function () {
      if (shown) return undefined;
      return Promise.resolve()
        .then(function () { return reg.showNotification(FALLBACK.title, options(FALLBACK)); })
        .catch(function () {
          // Last resort: the bare minimum call.
          return Promise.resolve().then(function () { return reg.showNotification(FALLBACK.title); }).catch(function () {});
        });
    });
  }

  /** Tap on a notification: focus the app if it's open (and send it to the question), else open it. */
  function handleNotificationClick(event, deps) {
    var data = (event.notification && event.notification.data) || {};
    try { event.notification.close(); } catch (e) { /* ignore */ }
    var target = new URL(data.url || './', deps.scope).href;
    return deps.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf(deps.scope) === 0 && typeof c.focus === 'function') {
          return Promise.resolve(c.focus()).then(function (focused) {
            var w = focused || c;
            try { w.postMessage({ type: 'OPEN_URL', url: target }); } catch (e) { /* ignore */ }
            return w;
          });
        }
      }
      return deps.clients.openWindow(target);
    });
  }

  // ---- real browser plumbing (unused by tests) ----

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(C.DB_NAME, C.DB_VERSION);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(C.STORE)) req.result.createObjectStore(C.STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(C.STORE, 'readonly');
        var r = tx.objectStore(C.STORE).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
        tx.oncomplete = function () { db.close(); };
      });
    });
  }

  function idbSet(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(C.STORE, 'readwrite');
        tx.objectStore(C.STORE).put(value, key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function cacheUrl(scope) { return new URL(C.SNAPSHOT_URL, scope).href; }

  function readSnapshotFromDevice(scope) {
    return idbGet(C.SNAPSHOT_KEY).then(function (s) {
      if (s) return s;
      throw new Error('no snapshot in IndexedDB');
    }).catch(function () {
      // Backup copy in Cache Storage.
      return caches.open(C.DATA_CACHE)
        .then(function (cache) { return cache.match(cacheUrl(scope)); })
        .then(function (res) { return res ? res.json() : null; })
        .catch(function () { return null; });
    });
  }

  function writeSnapshotToDevice(scope, snapshot) {
    var body = JSON.stringify(snapshot);
    return Promise.all([
      idbSet(C.SNAPSHOT_KEY, snapshot).catch(function () {}),
      caches.open(C.DATA_CACHE).then(function (cache) {
        return cache.put(cacheUrl(scope), new Response(body, { headers: { 'Content-Type': 'application/json' } }));
      }).catch(function () {}),
    ]);
  }

  function setBadge(count) {
    var nav = root.navigator;
    if (!nav) return Promise.resolve();
    if (count > 0 && typeof nav.setAppBadge === 'function') return nav.setAppBadge(count);
    if (count <= 0 && typeof nav.clearAppBadge === 'function') return nav.clearAppBadge();
    return Promise.resolve();
  }

  function deviceDeps(sw) {
    var scope = sw.registration.scope;
    return {
      registration: sw.registration,
      scope: scope,
      clients: sw.clients,
      readSnapshot: function () { return readSnapshotFromDevice(scope); },
      writeSnapshot: function (s) { return writeSnapshotToDevice(scope, s); },
      setBadge: setBadge,
      now: function () { return new Date(); },
    };
  }

  root.MakelinePush = {
    CONSTANTS: C,
    FALLBACK: FALLBACK,
    NO_DATA: NO_DATA,
    dayIndex: dayIndex,
    streakFrom: streakFrom,
    dueOn: dueOn,
    pushType: pushType,
    nextQuiz: nextQuiz,
    summaryText: summaryText,
    handlePush: handlePush,
    handleNotificationClick: handleNotificationClick,
    deviceDeps: deviceDeps,
  };
})(typeof self !== 'undefined' ? self : this);
