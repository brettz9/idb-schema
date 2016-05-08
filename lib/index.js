'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); // Object.values, etc.


require('babel-polyfill');

var _idbFactory = require('./idb-factory');

var _isPlainObj = require('is-plain-obj');

var _isPlainObj2 = _interopRequireDefault(_isPlainObj);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var values = Object.values;
var isInteger = Number.isInteger;
var localStorageExists = typeof window !== 'undefined' && window.localStorage;

var getJSONStorage = function getJSONStorage(item) {
  var dflt = arguments.length <= 1 || arguments[1] === undefined ? '{}' : arguments[1];

  return JSON.parse(localStorage.getItem(item) || dflt);
};
var setJSONStorage = function setJSONStorage(item, value) {
  localStorage.setItem(item, JSON.stringify(value));
};

/**
 * Maximum version value (unsigned long long)
 * http://www.w3.org/TR/IndexedDB/#events
 */

var MAX_VERSION = Math.pow(2, 32) - 1;

/**
 * Export `Schema`.
 */

var Schema = function () {
  function Schema() {
    _classCallCheck(this, Schema);

    this._stores = {};
    this._current = {};
    this._versions = {};
    this.version(1);
  }

  _createClass(Schema, [{
    key: 'lastEnteredVersion',
    value: function lastEnteredVersion() {
      return this._current.version;
    }
  }, {
    key: 'setCurrentVersion',
    value: function setCurrentVersion(version) {
      this._current = { version: version, store: null };
    }

    /**
     * Get/Set new version.
     *
     * @param {Number} [version]
     * @return {Schema|Number}
     */

  }, {
    key: 'version',
    value: function version(_version) {
      if (!arguments.length) return parseInt(Object.keys(this._versions).sort().pop(), 10);
      if (!isInteger(_version) || _version < 1 || _version > MAX_VERSION) {
        throw new TypeError('invalid version');
      }

      this.setCurrentVersion(_version);
      this._versions[_version] = {
        stores: [], // db.createObjectStore
        dropStores: [], // db.deleteObjectStore
        indexes: [], // store.createIndex
        dropIndexes: [], // store.deleteIndex
        callbacks: [],
        earlyCallbacks: [],
        version: _version };

      // version
      return this;
    }

    /**
     * Add store.
     *
     * @param {String} name
     * @param {Object} [opts] { key: null, increment: false, copyFrom: null }
     * @return {Schema}
     */

  }, {
    key: 'addStore',
    value: function addStore(name) {
      var _this = this;

      var opts = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

      if (typeof name !== 'string') throw new TypeError('"name" is required'); // idb-schema requirement
      if (this._stores[name]) throw new DOMException('"' + name + '" store is already defined', 'ConstraintError');
      if ((0, _isPlainObj2.default)(opts) && (0, _isPlainObj2.default)(opts.copyFrom)) {
        (function () {
          var copyFrom = opts.copyFrom;
          var copyFromName = copyFrom.name;
          if (typeof copyFromName !== 'string') throw new TypeError('"copyFrom.name" is required when `copyFrom` is present'); // idb-schema requirement
          if (_this._versions[_this.lastEnteredVersion()].dropStores.some(function (dropStore) {
            return dropStore.name === copyFromName;
          })) {
            throw new TypeError('"copyFrom.name" must not be a store slated for deletion.'); // idb-schema requirement
          }
          if (copyFrom.deleteOld) {
            var copyFromStore = _this._stores[copyFromName];
            if (copyFromStore) {
              // We don't throw here if non-existing since it may have been created outside of idb-schema
              delete _this._stores[copyFromName];
            }
          }
        })();
      }
      var store = {
        name: name,
        indexes: {},
        keyPath: opts.key || opts.keyPath,
        autoIncrement: opts.increment || opts.autoIncrement || false,
        copyFrom: opts.copyFrom || null };
      // We don't check here for existence of a copyFrom store as might be copying from preexisting store
      if (!store.keyPath && store.keyPath !== '') {
        store.keyPath = null;
      }
      if (store.autoIncrement && (store.keyPath === '' || Array.isArray(store.keyPath))) {
        throw new DOMException('keyPath must not be the empty string or a sequence if autoIncrement is in use', 'InvalidAccessError');
      }

      this._stores[name] = store;
      this._versions[this.lastEnteredVersion()].stores.push(store);
      this._current.store = store;

      return this;
    }

    /**
     * Delete store.
     *
     * @param {String} name
     * @return {Schema}
     */

  }, {
    key: 'delStore',
    value: function delStore(name) {
      if (typeof name !== 'string') throw new TypeError('"name" is required'); // idb-schema requirement
      this._versions[this.lastEnteredVersion()].stores.forEach(function (store) {
        var copyFrom = store.copyFrom;
        if ((0, _isPlainObj2.default)(copyFrom) && name === copyFrom.name) {
          if (copyFrom.deleteOld) {
            throw new TypeError('"name" is already slated for deletion'); // idb-schema requirement
          }
          throw new TypeError('set `deleteOld` on `copyFrom` to delete this store.'); // idb-schema requirement
        }
      });
      var store = this._stores[name];
      if (store) {
        delete this._stores[name];
      } else {
        store = { name: name };
      }
      this._versions[this.lastEnteredVersion()].dropStores.push(store);
      this._current.store = null;
      return this;
    }

    /**
     * Rename store.
     *
     * @param {String} oldName Old name
     * @param {String} newName New name
     * @param {Object} [opts] { key: null, increment: false }
     * @return {Schema}
    */

  }, {
    key: 'renameStore',
    value: function renameStore(oldName, newName, options) {
      return this.copyStore(oldName, newName, options, true);
    }

    /**
     * Copy store.
     *
     * @param {String} oldName Old name
     * @param {String} newName New name
     * @param {Object} [opts] { key: null, increment: false }
     * @param {Boolean} [deleteOld=false] Whether to delete the old store or not
     * @return {Schema}
    */

  }, {
    key: 'copyStore',
    value: function copyStore(oldName, newName, options) {
      var deleteOld = arguments.length <= 3 || arguments[3] === undefined ? false : arguments[3];

      if (typeof oldName !== 'string') throw new TypeError('"oldName" is required'); // idb-schema requirement
      if (typeof newName !== 'string') throw new TypeError('"newName" is required'); // idb-schema requirement

      options = (0, _isPlainObj2.default)(options) ? _clone(options) : {};
      options.copyFrom = { name: oldName, deleteOld: deleteOld, options: options };

      return this.addStore(newName, options);
    }

    /**
     * Change current store.
     *
     * @param {String} name
     * @return {Schema}
     */

  }, {
    key: 'getStore',
    value: function getStore(name) {
      var _this2 = this;

      if (name && (typeof name === 'undefined' ? 'undefined' : _typeof(name)) === 'object' && 'name' in name && 'indexNames' in name) {
        (function () {
          var storeObj = name;
          name = storeObj.name;
          var store = {
            name: name,
            indexes: Array.from(storeObj.indexNames).reduce(function (obj, iName) {
              var indexObj = storeObj.index(iName);
              obj[iName] = {
                name: iName,
                storeName: name,
                field: indexObj.keyPath,
                unique: indexObj.unique,
                multiEntry: indexObj.multiEntry
              };
              return obj;
            }, {}),
            keyPath: storeObj.keyPath,
            autoIncrement: storeObj.autoIncrement,
            copyFrom: null
          };
          _this2._stores[name] = store;
        })();
      }
      if (typeof name !== 'string') throw new DOMException('"name" is required', 'NotFoundError');
      if (!this._stores[name]) throw new TypeError('"' + name + '" store is not defined');
      this._current.store = this._stores[name];
      return this;
    }

    /**
     * Add index.
     *
     * @param {String} name
     * @param {String|Array} field
     * @param {Object} [opts] { unique: false, multi: false }
     * @return {Schema}
     */

  }, {
    key: 'addIndex',
    value: function addIndex(name, field) {
      var opts = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

      if (typeof name !== 'string') throw new TypeError('"name" is required'); // idb-schema requirement
      if (typeof field !== 'string' && !Array.isArray(field)) {
        throw new SyntaxError('"field" is required');
      }
      var store = this._current.store;
      if (!store) throw new TypeError('set current store using "getStore" or "addStore"');
      if (store.indexes[name]) throw new DOMException('"' + name + '" index is already defined', 'ConstraintError');

      var index = {
        name: name,
        field: field,
        storeName: store.name,
        multiEntry: opts.multi || opts.multiEntry || false,
        unique: opts.unique || false
      };
      store.indexes[name] = index;
      this._versions[this.lastEnteredVersion()].indexes.push(index);

      return this;
    }

    /**
     * Delete index.
     *
     * @param {String} name
     * @return {Schema}
     */

  }, {
    key: 'delIndex',
    value: function delIndex(name) {
      if (typeof name !== 'string') throw new TypeError('"name" is required'); // idb-schema requirement
      var index = this._current.store.indexes[name];
      if (!index) throw new DOMException('"' + name + '" index is not defined', 'NotFoundError');
      delete this._current.store.indexes[name];
      this._versions[this.lastEnteredVersion()].dropIndexes.push(index);
      return this;
    }

    /**
     * Add a callback to be executed at the end of the `upgradeneeded` event.
     * Callback will be supplied the `upgradeneeded` event object.
     *
     * @param {Function} cb
     * @return {Schema}
     */

  }, {
    key: 'addCallback',
    value: function addCallback(cb) {
      this._versions[this.lastEnteredVersion()].callbacks.push(cb);
      return this;
    }
  }, {
    key: 'addEarlyCallback',
    value: function addEarlyCallback(cb) {
      this._versions[this.lastEnteredVersion()].earlyCallbacks.push(cb);
      return this;
    }

    /**
     * Flushes storage pertaining to incomplete upgrades
     *
     * @return {}
     */

  }, {
    key: 'flushIncomplete',
    value: function flushIncomplete(dbName) {
      var incompleteUpgrades = getJSONStorage('idb-incompleteUpgrades');
      delete incompleteUpgrades[dbName];
      setJSONStorage('idb-incompleteUpgrades', incompleteUpgrades);
    }

    /**
     * Generate open connection running a sequence of upgrades, keeping the connection open.
     *
     * @return {Promise}
     */

  }, {
    key: 'open',
    value: function open(dbName, version) {
      return this.upgrade(dbName, version, true);
    }

    /**
     * Generate open connection running a sequence of upgrades.
     *
     * @return {Promise}
     */

  }, {
    key: 'upgrade',
    value: function upgrade(dbName, version, keepOpen) {
      var _this3 = this;

      var currentVersion = void 0;
      var versions = void 0;
      var afterOpen = void 0;
      var setVersions = function setVersions() {
        versions = values(_this3._versions).sort(function (a, b) {
          return a.version - b.version;
        }).map(function (obj) {
          return obj.version;
        }).values();
      };
      var blockRecover = function blockRecover(reject) {
        return function (err) {
          if (err && err.type === 'blocked') {
            reject(err);
            return;
          }
          throw err;
        };
      };
      setVersions();
      var thenableUpgradeVersion = function thenableUpgradeVersion(dbLast, res, rej, start) {
        var lastVers = dbLast.version;
        var ready = true;
        var lastGoodVersion = void 0;
        var versionIter = void 0;
        for (versionIter = versions.next(); !versionIter.done && versionIter.value <= lastVers; versionIter = versions.next()) {
          lastGoodVersion = versionIter.value;
        }
        currentVersion = versionIter.value;
        if (versionIter.done || currentVersion > version) {
          if (start !== undefined) {
            currentVersion = lastGoodVersion;
            afterOpen(dbLast, res, rej, start);
          } else if (!keepOpen) {
            dbLast.close();
            res();
          } else {
            res(dbLast);
          }
          return;
        }
        dbLast.close();

        setTimeout(function () {
          (0, _idbFactory.open)(dbName, currentVersion, upgradeneeded(function () {
            for (var _len = arguments.length, dbInfo = Array(_len), _key = 0; _key < _len; _key++) {
              dbInfo[_key] = arguments[_key];
            }

            ready = false;
            upgradeVersion.call.apply(upgradeVersion, [_this3, currentVersion].concat(dbInfo, [function () {
              ready = true;
            }]));
          })).then(function (db) {
            var intvl = setInterval(function () {
              if (ready) {
                clearInterval(intvl);
                afterOpen(db, res, rej, start);
              }
            }, 100);
          }).catch(function (err) {
            rej(err);
          });
        });
      };
      afterOpen = function afterOpen(db, res, rej, start) {
        // We run callbacks in `success` so promises can be used without fear of the (upgrade) transaction expiring
        var processReject = function processReject(err, callbackIndex) {
          err = typeof err === 'string' ? new Error(err) : err;
          err.retry = function () {
            return new Promise(function (resolv, rejct) {
              var resolver = function resolver(item) {
                _this3.flushIncomplete(dbName);
                resolv(item);
              };
              db.close();
              // db.transaction can't execute as closing by now, so we close and reopen
              (0, _idbFactory.open)(dbName).catch(blockRecover(rejct)).then(function (dbs) {
                setVersions();
                thenableUpgradeVersion(dbs, resolver, rejct, callbackIndex);
              }).catch(rejct);
            });
          };
          if (localStorageExists) {
            var incompleteUpgrades = getJSONStorage('idb-incompleteUpgrades');
            incompleteUpgrades[dbName] = {
              version: db.version,
              error: err.message,
              callbackIndex: callbackIndex
            };
            setJSONStorage('idb-incompleteUpgrades', incompleteUpgrades);
          }
          db.close();
          rej(err);
        };
        var promise = Promise.resolve();
        var lastIndex = void 0;
        var versionSchema = _this3._versions[currentVersion]; // We can safely cache as these callbacks do not need to access schema info
        var cbFailed = versionSchema.callbacks.some(function (cb, i) {
          if (start !== undefined && i < start) {
            return false;
          }
          var ret = void 0;
          try {
            ret = cb(db);
          } catch (err) {
            processReject(err, i);
            return true;
          }
          if (ret && ret.then) {
            // We need to treat the rest as promises so that they do not
            //   continue to execute before the current one has a chance to
            //   execute or fail
            promise = versionSchema.callbacks.slice(i + 1).reduce(function (p, cb2) {
              return p.then(function () {
                return cb2(db);
              });
            }, ret);
            lastIndex = i;
            return true;
          }
        });
        var complete = lastIndex !== undefined;
        if (cbFailed && !complete) return;
        promise = promise.then(function () {
          return thenableUpgradeVersion(db, res, rej);
        });
        if (complete) {
          promise = promise.catch(function (err) {
            processReject(err, lastIndex);
          });
        }
      };
      // If needed, open higher versions until fully upgraded (noting any transaction failures)
      return new Promise(function (resolve, reject) {
        version = version || _this3.version();
        if (typeof version !== 'number' || version < 1) {
          reject(new Error('Bad version supplied for idb-schema upgrade'));
          return;
        }

        var incompleteUpgrades = void 0;
        var iudb = void 0;
        if (localStorageExists) {
          incompleteUpgrades = getJSONStorage('idb-incompleteUpgrades');
          iudb = incompleteUpgrades[dbName];
        }
        if (iudb) {
          var _ret3 = function () {
            var err = new Error('An upgrade previously failed to complete for version: ' + iudb.version + ' due to reason: ' + iudb.error);
            err.badVersion = iudb.version;
            err.retry = function () {
              var versionIter = versions.next();
              while (!versionIter.done && versionIter.value < err.badVersion) {
                versionIter = versions.next();
              }
              currentVersion = versionIter.value;
              return new Promise(function (resolv, rejct) {
                var resolver = function resolver(item) {
                  _this3.flushIncomplete(dbName);
                  resolv(item);
                };
                // If there was a prior failure, we don't need to worry about `upgradeneeded` yet
                (0, _idbFactory.open)(dbName).catch(blockRecover(rejct)).then(function (dbs) {
                  afterOpen(dbs, resolver, rejct, iudb.callbackIndex);
                }).catch(rejct);
              });
            };
            reject(err);
            return {
              v: void 0
            };
          }();

          if ((typeof _ret3 === 'undefined' ? 'undefined' : _typeof(_ret3)) === "object") return _ret3.v;
        }
        var ready = true;
        var upgrade = upgradeneeded(function () {
          for (var _len2 = arguments.length, dbInfo = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
            dbInfo[_key2] = arguments[_key2];
          }

          // Upgrade from 0 to version 1
          ready = false;
          var versionIter = versions.next();
          if (versionIter.done) {
            throw new Error('No schema versions added for upgrade');
          }
          currentVersion = versionIter.value;
          upgradeVersion.call.apply(upgradeVersion, [_this3, currentVersion].concat(dbInfo, [function () {
            ready = true;
          }]));
        });
        (0, _idbFactory.open)(dbName, upgrade).catch(blockRecover(reject)).then(function (db) {
          var intvl = setInterval(function () {
            if (!ready) {
              return;
            }
            clearInterval(intvl);
            if (version < db.version) {
              db.close();
              reject(new DOMException('The requested version (' + version + ') is less than the existing version (' + db.version + ').', 'VersionError'));
              return;
            }
            if (currentVersion !== undefined) {
              afterOpen(db, resolve, reject);
              return;
            }
            thenableUpgradeVersion(db, resolve, reject);
          }, 100);
        }).catch(function (err) {
          return reject(err);
        });
      });
    }

    /**
     * Generate onupgradeneeded callback running a sequence of upgrades.
     *
     * @return {Function}
     */

  }, {
    key: 'callback',
    value: function callback(_callback, errBack) {
      var _this4 = this;

      var versions = values(this._versions).sort(function (a, b) {
        return a.version - b.version;
      }).map(function (obj) {
        return obj.version;
      }).values();
      var tryCatch = function tryCatch(e, cb) {
        try {
          cb();
        } catch (err) {
          if (errBack) {
            errBack(err, e);
            return true;
          }
          throw err;
        }
      };
      var upgrade = function upgrade(e, oldVersion) {
        var versionIter = versions.next();
        while (!versionIter.done && versionIter.value <= oldVersion) {
          versionIter = versions.next();
        }

        if (versionIter.done) {
          if (_callback) _callback(e);
          return;
        }
        var version = versionIter.value;
        var lev = _this4.lastEnteredVersion();

        tryCatch(e, function () {
          upgradeVersion.call(_this4, version, e, oldVersion, function () {
            tryCatch(e, function () {
              _this4._versions[version].callbacks.forEach(function (cb) {
                _this4.setCurrentVersion(version); // Reset current version for callback to be able to operate on this version rather than the last added one
                cb.call(_this4, e); // Call on `this` as can still modify schema in these callbacks
              });
              _this4.setCurrentVersion(lev);
              upgrade(e, oldVersion);
            });
          });
        });
      };
      return upgradeneeded(upgrade);
    }

    /**
     * Get a description of the stores.
     * It creates a deep clone of `this._stores` object
     * and transform it to an array.
     *
     * @return {Array}
     */

  }, {
    key: 'stores',
    value: function stores() {
      return values(_clone(this._stores)).map(function (store) {
        store.indexes = values(store.indexes).map(function (index) {
          delete index.storeName;
          return index;
        });
        return store;
      });
    }

    /**
     * Clone `this` to new schema object.
     *
     * @return {Schema} - new object
     */

  }, {
    key: 'clone',
    value: function clone() {
      var _this5 = this;

      var schema = new Schema();
      Object.keys(this).forEach(function (key) {
        return schema[key] = _clone(_this5[key]);
      });
      return schema;
    }
  }]);

  return Schema;
}();

/**
 * Clone `obj`.
 * https://github.com/component/clone/blob/master/index.js
 */

exports.default = Schema;
function _clone(obj) {
  if (Array.isArray(obj)) {
    return obj.map(function (val) {
      return _clone(val);
    });
  }
  if ((0, _isPlainObj2.default)(obj)) {
    return Object.keys(obj).reduce(function (copy, key) {
      copy[key] = _clone(obj[key]);
      return copy;
    }, {});
  }
  return obj;
}

/**
 * Utility for `upgradeneeded`.
 * @todo Can `oldVersion` be overwritten and this utility exposed within idb-factory?
 */

function upgradeneeded(cb) {
  return function (e) {
    var oldVersion = e.oldVersion > MAX_VERSION ? 0 : e.oldVersion; // Safari bug: https://bugs.webkit.org/show_bug.cgi?id=136888
    cb(e, oldVersion);
  };
}

function upgradeVersion(version, e, oldVersion, finishedCb) {
  var _this6 = this;

  if (oldVersion >= version) return;

  var db = e.target.result;
  var tr = e.target.transaction;

  var lev = this.lastEnteredVersion();
  this._versions[version].earlyCallbacks.forEach(function (cb) {
    _this6.setCurrentVersion(version); // Reset current version for callback to be able to operate on this version rather than the last added one
    cb.call(_this6, e);
  });
  this.setCurrentVersion(lev);

  // Now we can cache as no more callbacks to modify this._versions data
  var versionSchema = this._versions[version];
  versionSchema.dropStores.forEach(function (s) {
    db.deleteObjectStore(s.name);
  });

  // We wait for addition of old data and then for the deleting of the old
  //   store before iterating to add the next store (in case the user may
  //   create a new store of the same name as an old deleted store)
  var stores = versionSchema.stores.values();
  function iterateStores() {
    var storeIter = stores.next();
    if (storeIter.done) {
      versionSchema.dropIndexes.forEach(function (i) {
        tr.objectStore(i.storeName).deleteIndex(i.name);
      });

      versionSchema.indexes.forEach(function (i) {
        tr.objectStore(i.storeName).createIndex(i.name, i.field, {
          unique: i.unique,
          multiEntry: i.multiEntry
        });
      });
      if (finishedCb) finishedCb();
      return;
    }
    var s = storeIter.value;

    // Only pass the options that are explicitly specified to createObjectStore() otherwise IE/Edge
    // can throw an InvalidAccessError - see https://msdn.microsoft.com/en-us/library/hh772493(v=vs.85).aspx
    var opts = {};
    var oldStoreName = void 0;
    var oldObjStore = void 0;
    if (s.copyFrom) {
      // Store props not set yet as need reflection (and may be store not in idb-schema)
      oldStoreName = s.copyFrom.name;
      oldObjStore = tr.objectStore(oldStoreName);
      var oldObjStoreOptions = s.copyFrom.options || {};
      if (oldObjStoreOptions.keyPath !== null && oldObjStoreOptions.keyPath !== undefined) opts.keyPath = oldObjStoreOptions.keyPath;else if (oldObjStore.keyPath !== null && s.keyPath !== undefined) opts.keyPath = oldObjStore.keyPath;
      if (oldObjStoreOptions.autoIncrement !== undefined) opts.autoIncrement = oldObjStoreOptions.autoIncrement;else if (oldObjStore.autoIncrement) opts.autoIncrement = oldObjStore.autoIncrement;
    } else {
      if (s.keyPath !== null && s.keyPath !== undefined) opts.keyPath = s.keyPath;
      if (s.autoIncrement) opts.autoIncrement = s.autoIncrement;
    }

    var newObjStore = db.createObjectStore(s.name, opts);
    if (!s.copyFrom) {
      iterateStores();
      return;
    }
    var req = oldObjStore.getAll();
    req.onsuccess = function () {
      var oldContents = req.result;
      var ct = 0;

      if (!oldContents.length && s.copyFrom.deleteOld) {
        db.deleteObjectStore(oldStoreName);
        iterateStores();
        return;
      }
      oldContents.forEach(function (oldContent) {
        var addReq = newObjStore.add(oldContent);
        addReq.onsuccess = function () {
          ct++;
          if (ct === oldContents.length) {
            if (s.copyFrom.deleteOld) {
              db.deleteObjectStore(oldStoreName);
            }
            iterateStores();
          }
        };
      });
    };
  }
  iterateStores();
}
module.exports = exports['default'];