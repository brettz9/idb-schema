import 'babel-polyfill' // Object.values, etc.
import { open } from './idb-factory'
import isPlainObj from 'is-plain-obj'

const values = Object.values
const isInteger = Number.isInteger
const localStorageExists = typeof window !== 'undefined' && window.localStorage

const getJSONStorage = (item, dflt) => {
  return JSON.parse(localStorage.getItem(item) || dflt || '{}')
}
const setJSONStorage = (item, value) => {
  localStorage.setItem(item, JSON.stringify(value))
}

/**
 * Maximum version value (unsigned long long)
 * http://www.w3.org/TR/IndexedDB/#events
 */

const MAX_VERSION = Math.pow(2, 32) - 1

/**
 * Export `Schema`.
 */

export default class Schema {
  constructor() {
    this._stores = {}
    this._current = {}
    this._versions = {}
    this.version(1)
  }

  /**
   * Get/Set new version.
   *
   * @param {Number} [version]
   * @return {Schema|Number}
   */

  version(version) {
    if (!arguments.length) return this._current.version
    if (!isInteger(version) || version < 1 || version < this.version() || version > MAX_VERSION) {
      throw new TypeError('invalid version')
    }

    this._current = { version: version, store: null }
    this._versions[version] = {
      stores: [],       // db.createObjectStore
      dropStores: [],   // db.deleteObjectStore
      indexes: [],      // store.createIndex
      dropIndexes: [],  // store.deleteIndex
      callbacks: [],
      version: version, // version
    }

    return this
  }

  /**
   * Add store.
   *
   * @param {String} name
   * @param {Object} [opts] { key: null, increment: false }
   * @return {Schema}
   */

  addStore(name, opts = {}) {
    if (typeof name !== 'string' || !name) throw new TypeError('"name" is required')
    if (this._stores[name]) throw new TypeError(`"${name}" store is already defined`)

    const store = {
      name: name,
      indexes: {},
      keyPath: opts.key || opts.keyPath || null,
      autoIncrement: opts.increment || opts.autoIncrement || false,
    }
    if (store.autoIncrement && !store.keyPath) {
      throw new TypeError('set keyPath in order to use autoIncrement')
    }

    this._stores[name] = store
    this._versions[this.version()].stores.push(store)
    this._current.store = store

    return this
  }

  /**
   * Delete store.
   *
   * @param {String} name
   * @return {Schema}
   */

  delStore(name) {
    if (typeof name !== 'string' || !name) throw new TypeError('"name" is required')
    const store = this._stores[name]
    if (!store) throw new TypeError(`"${name}" store is not defined`)
    delete this._stores[name]
    this._versions[this.version()].dropStores.push(store)
    this._current.store = null
    return this
  }

  /**
   * Change current store.
   *
   * @param {String} name
   * @return {Schema}
   */

  getStore(name) {
    if (typeof name !== 'string' || !name) throw new TypeError('"name" is required')
    if (!this._stores[name]) throw new TypeError(`"${name}" store is not defined`)
    this._current.store = this._stores[name]
    return this
  }

  /**
   * Add index.
   *
   * @param {String} name
   * @param {String|Array} field
   * @param {Object} [opts] { unique: false, multi: false }
   * @return {Schema}
   */

  addIndex(name, field, opts = {}) {
    if (typeof name !== 'string' || !name) throw new TypeError('"name" is required')
    if (typeof field !== 'string' && !Array.isArray(field)) {
      throw new TypeError('"field" is required')
    }
    const store = this._current.store
    if (!store) throw new TypeError('set current store using "getStore" or "addStore"')
    if (store.indexes[name]) throw new TypeError(`"${name}" index is already defined`)

    const index = {
      name: name,
      field: field,
      storeName: store.name,
      multiEntry: opts.multi || opts.multiEntry || false,
      unique: opts.unique || false,
    }
    store.indexes[name] = index
    this._versions[this.version()].indexes.push(index)

    return this
  }

  /**
   * Delete index.
   *
   * @param {String} name
   * @return {Schema}
   */

  delIndex(name) {
    if (typeof name !== 'string' || !name) throw new TypeError('"name" is required')
    const index = this._current.store.indexes[name]
    if (!index) throw new TypeError(`"${name}" index is not defined`)
    delete this._current.store.indexes[name]
    this._versions[this.version()].dropIndexes.push(index)
    return this
  }

  /**
   * Add a callback to be executed at the end of the `upgradeneeded` event.
   * Callback will be supplied the `upgradeneeded` event object.
   *
   * @param {Function} cb
   * @return {Schema}
   */

  addCallback(cb) {
    this._versions[this.version()].callbacks.push(cb)
    return this
  }

  /**
   * Flushes storage pertaining to incomplete upgrades
   *
   * @return {}
   */
  flushIncomplete(dbName) {
    const incompleteUpgrades = getJSONStorage('idb-incompleteUpgrades')
    delete incompleteUpgrades[dbName]
    setJSONStorage('idb-incompleteUpgrades', incompleteUpgrades)
  }

  /**
   * Generate open connection running a sequence of upgrades, keeping the connection open.
   *
   * @return {Promise}
   */

  open(dbName, version) {
    return this.upgrade(dbName, version, true)
  }

  /**
   * Generate open connection running a sequence of upgrades.
   *
   * @return {Promise}
   */

  upgrade(dbName, version, keepOpen) {
    let versionSchema
    let versions
    let afterOpen
    const setVersions = () => {
      versions = values(this._versions).sort((a, b) => a.version - b.version).values()
    }
    const blockRecover = (reject) => {
      return (err) => {
        if (err && err.type === 'blocked') {
          reject(err)
          return
        }
        throw err
      }
    }
    setVersions()
    function thenableUpgradeVersion(dbLast, res, rej, start) {
      const lastVers = dbLast.version
      let lastGoodSchema
      let versionIter
      for (versionIter = versions.next();
        (!versionIter.done && versionIter.value.version <= lastVers);
        versionIter = versions.next()
      ) {
        lastGoodSchema = versionIter.value
      }
      versionSchema = versionIter.value
      if (versionIter.done || versionSchema.version > version) {
        if (start !== undefined) {
          versionSchema = lastGoodSchema
          afterOpen(dbLast, res, rej, start)
        } else if (!keepOpen) {
          dbLast.close()
          res()
        } else {
          res(dbLast)
        }
        return
      }
      dbLast.close()

      setTimeout(() => {
        open(dbName, versionSchema.version, upgradeneeded((e, ...dbInfo) => {
          upgradeVersion(versionSchema, ...dbInfo)
        })).then((db) => {
          afterOpen(db, res, rej, start)
        }).catch((err) => {
          rej(err)
        })
      })
    }
    afterOpen = (db, res, rej, start) => {
      // We run callbacks in `success` so promises can be used without fear of the (upgrade) transaction expiring
      const processReject = (err, callbackIndex) => {
        err = typeof err === 'string' ? new Error(err) : err
        err.retry = () => {
          return new Promise((resolv, rejct) => {
            const resolver = (item) => {
              this.flushIncomplete(dbName)
              resolv(item)
            }
            db.close()
            // db.transaction can't execute as closing by now, so we close and reopen
            open(dbName).catch(blockRecover(rejct)).then((dbs) => {
              setVersions()
              thenableUpgradeVersion(dbs, resolver, rejct, callbackIndex)
            }).catch(rejct)
          })
        }
        if (localStorageExists) {
          const incompleteUpgrades = getJSONStorage('idb-incompleteUpgrades')
          incompleteUpgrades[dbName] = {
            version: db.version,
            error: err.message,
            callbackIndex,
          }
          setJSONStorage('idb-incompleteUpgrades', incompleteUpgrades)
        }
        db.close()
        rej(err)
      }
      let promise = Promise.resolve()
      let lastIndex
      const cbFailed = versionSchema.callbacks.some((cb, i) => {
        if (start !== undefined && i < start) {
          return false
        }
        let ret
        try {
          ret = cb(db)
        } catch (err) {
          processReject(err, i)
          return true
        }
        if (ret && ret.then) {
          // We need to treat the rest as promises so that they do not
          //   continue to execute before the current one has a chance to
          //   execute or fail
          promise = versionSchema.callbacks.slice(i + 1).reduce((p, cb2) => {
            return p.then(() => {
              return cb2(db)
            })
          }, ret)
          lastIndex = i
          return true
        }
      })
      const complete = lastIndex !== undefined
      if (cbFailed && !complete) return
      promise = promise.then(() => thenableUpgradeVersion(db, res, rej))
      if (complete) {
        promise = promise.catch((err) => {
          processReject(err, lastIndex)
        })
      }
    }
    // If needed, open higher versions until fully upgraded (noting any transaction failures)
    return new Promise((resolve, reject) => {
      version = version || this.version()
      if (typeof version !== 'number' || version < 1) {
        reject(new Error('Bad version supplied for idb-schema upgrade'))
        return
      }

      let incompleteUpgrades
      let iudb
      if (localStorageExists) {
        incompleteUpgrades = getJSONStorage('idb-incompleteUpgrades')
        iudb = incompleteUpgrades[dbName]
      }
      if (iudb) {
        const err = new Error(
          'An upgrade previously failed to complete for version: ' + iudb.version +
          ' due to reason: ' + iudb.error
        )
        err.badVersion = iudb.version
        err.retry = () => {
          let versionIter = versions.next()
          while (!versionIter.done && versionIter.value.version < err.badVersion) {
            versionIter = versions.next()
          }
          versionSchema = versionIter.value
          return new Promise((resolv, rejct) => {
            const resolver = (item) => {
              this.flushIncomplete(dbName)
              resolv(item)
            }
            // If there was a prior failure, we don't need to worry about `upgradeneeded` yet
            open(dbName).catch(blockRecover(rejct)).then((dbs) => {
              afterOpen(dbs, resolver, rejct, iudb.callbackIndex)
            }).catch(rejct)
          })
        }
        reject(err)
        return
      }
      const upgrade = upgradeneeded((e, ...dbInfo) => {
        // Upgrade from 0 to version 1
        const versionIter = versions.next()
        if (versionIter.done) {
          throw new Error('No schema versions added for upgrade')
        }
        versionSchema = versionIter.value
        upgradeVersion(versionSchema, ...dbInfo)
      })
      open(dbName, upgrade).catch(blockRecover(reject)).then((db) => {
        if (version < db.version) {
          db.close()
          reject(new DOMException('The requested version (' + version + ') is less than the existing version (' + db.version + ').', 'VersionError'))
          return
        }
        if (versionSchema) {
          afterOpen(db, resolve, reject)
          return
        }
        thenableUpgradeVersion(db, resolve, reject)
      }).catch((err) => reject(err))
    })
  }

  /**
   * Generate onupgradeneeded callback running a sequence of upgrades.
   *
   * @return {Function}
   */

  callback() {
    const versions = values(clone(this._versions)).sort((a, b) => a.version - b.version)
    return upgradeneeded((e, ...dbInfo) => {
      versions.forEach((versionSchema) => {
        upgradeVersion(versionSchema, ...dbInfo)
        versionSchema.callbacks.forEach((cb) => {
          cb(e)
        })
      })
    })
  }

  /**
   * Get a description of the stores.
   * It creates a deep clone of `this._stores` object
   * and transform it to an array.
   *
   * @return {Array}
   */

  stores() {
    return values(clone(this._stores)).map((store) => {
      store.indexes = values(store.indexes).map((index) => {
        delete index.storeName
        return index
      })
      return store
    })
  }

  /**
   * Clone `this` to new schema object.
   *
   * @return {Schema} - new object
   */

  clone() {
    const schema = new Schema()
    Object.keys(this).forEach((key) => schema[key] = clone(this[key]))
    return schema
  }
}

/**
 * Clone `obj`.
 * https://github.com/component/clone/blob/master/index.js
 */

function clone(obj) {
  if (Array.isArray(obj)) {
    return obj.map((val) => clone(val))
  }
  if (isPlainObj(obj)) {
    return Object.keys(obj).reduce((copy, key) => {
      copy[key] = clone(obj[key])
      return copy
    }, {})
  }
  return obj
}

/**
 * Utility for `upgradeneeded`.
 * @todo Can `oldVersion` be overwritten and this utility exposed within idb-factory?
 */

function upgradeneeded(cb) {
  return (e) => {
    const oldVersion = e.oldVersion > MAX_VERSION ? 0 : e.oldVersion // Safari bug: https://bugs.webkit.org/show_bug.cgi?id=136888
    const db = e.target.result
    const tr = e.target.transaction
    cb(e, oldVersion, db, tr)
  }
}

function upgradeVersion(versionSchema, oldVersion, db, tr) {
  if (oldVersion >= versionSchema.version) return

  versionSchema.stores.forEach((s) => {
    // Only pass the options that are explicitly specified to createObjectStore() otherwise IE/Edge
    // can throw an InvalidAccessError - see https://msdn.microsoft.com/en-us/library/hh772493(v=vs.85).aspx
    const opts = {}
    if (s.keyPath) opts.keyPath = s.keyPath
    if (s.autoIncrement) opts.autoIncrement = s.autoIncrement
    db.createObjectStore(s.name, opts)
  })

  versionSchema.dropStores.forEach((s) => {
    db.deleteObjectStore(s.name)
  })

  versionSchema.indexes.forEach((i) => {
    tr.objectStore(i.storeName).createIndex(i.name, i.field, {
      unique: i.unique,
      multiEntry: i.multiEntry,
    })
  })

  versionSchema.dropIndexes.forEach((i) => {
    tr.objectStore(i.storeName).deleteIndex(i.name)
  })
}
