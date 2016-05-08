'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.open = open;
exports.del = del;
exports.cmp = cmp;

/**
 * Open IndexedDB database with `name`.
 * Retry logic allows to avoid issues in tests env,
 * when db with the same name delete/open repeatedly and can be blocked.
 *
 * @param {String} dbName
 * @param {Number} [version]
 * @param {Function} [upgradeCallback]
 * @return {Promise}
 */

function open(dbName, version, upgradeCallback) {
  return new Promise(function (resolve, reject) {
    if (typeof version === 'function') {
      upgradeCallback = version;
      version = undefined;
    }
    // don't call open with 2 arguments, when version is not set
    var req = version ? idb().open(dbName, version) : idb().open(dbName);
    req.onblocked = function (e) {
      var resume = new Promise(function (res, rej) {
        // We overwrite handlers rather than make a new
        //   open() since the original request is still
        //   open and its onsuccess will still fire if
        //   the user unblocks by closing the blocking
        //   connection
        req.onsuccess = function (ev) {
          return res(ev.target.result);
        };
        req.onerror = function (ev) {
          ev.preventDefault();
          rej(ev);
        };
      });
      e.resume = resume;
      reject(e);
    };
    if (typeof upgradeCallback === 'function') {
      req.onupgradeneeded = function (e) {
        try {
          upgradeCallback(e);
        } catch (err) {
          // We allow the callback to throw its own error
          e.target.result.close();
          reject(err);
        }
      };
    }
    req.onerror = function (e) {
      e.preventDefault();
      reject(e);
    };
    req.onsuccess = function (e) {
      resolve(e.target.result);
    };
  });
}

/**
 * Delete `db` properly:
 * - close it and wait 100ms to disk flush (Safari, older Chrome, Firefox)
 * - if database is locked, due to inconsistent exectution of `versionchange`,
 *   try again in 100ms
 *
 * @param {IDBDatabase|String} db
 * @return {Promise}
 */

function del(db) {
  var dbName = typeof db !== 'string' ? db.name : db;

  return new Promise(function (resolve, reject) {
    var delDb = function delDb() {
      var req = idb().deleteDatabase(dbName);
      req.onblocked = function (e) {
        // The following addresses part of https://bugzilla.mozilla.org/show_bug.cgi?id=1220279
        e = e.newVersion === null || typeof Proxy === 'undefined' ? e : new Proxy(e, { get: function get(target, name) {
            return name === 'newVersion' ? null : target[name];
          } });
        var resume = new Promise(function (res, rej) {
          // We overwrite handlers rather than make a new
          //   delete() since the original request is still
          //   open and its onsuccess will still fire if
          //   the user unblocks by closing the blocking
          //   connection
          req.onsuccess = function (ev) {
            // The following are needed currently by PhantomJS: https://github.com/ariya/phantomjs/issues/14141
            if (!('newVersion' in ev)) {
              ev.newVersion = e.newVersion;
            }

            if (!('oldVersion' in ev)) {
              ev.oldVersion = e.oldVersion;
            }

            res(ev);
          };
          req.onerror = function (ev) {
            ev.preventDefault();
            rej(ev);
          };
        });
        e.resume = resume;
        reject(e);
      };
      req.onerror = function (e) {
        e.preventDefault();
        reject(e);
      };
      req.onsuccess = function (e) {
        // The following is needed currently by PhantomJS (though we cannot polyfill `oldVersion`): https://github.com/ariya/phantomjs/issues/14141
        if (!('newVersion' in e)) {
          e.newVersion = null;
        }

        resolve(e);
      };
    };

    if (typeof db !== 'string') {
      db.close();
      setTimeout(delDb, 100);
    } else {
      delDb();
    }
  });
}

/**
 * Compare `first` and `second`.
 * Added for consistency with official API.
 *
 * @param {Any} first
 * @param {Any} second
 * @return {Number} -1|0|1
 */

function cmp(first, second) {
  return idb().cmp(first, second);
}

/**
 * Get globally available IDBFactory instance.
 * - it uses `global`, so it can work in any env.
 * - it tries to use `global.forceIndexedDB` first,
 *   so you can rewrite `global.indexedDB` with polyfill
 *   https://bugs.webkit.org/show_bug.cgi?id=137034
 * - it fallbacks to all possibly available implementations
 *   https://github.com/axemclion/IndexedDBShim#ios
 * - function allows to have dynamic link,
 *   which can be changed after module's initial exectution
 *
 * @return {IDBFactory}
 */

function idb() {
  return global.forceIndexedDB || global.indexedDB || global.webkitIndexedDB || global.mozIndexedDB || global.msIndexedDB || global.shimIndexedDB;
}