# idb-schema

> IndexedDB schema manager.

[![](https://saucelabs.com/browser-matrix/idb-schema.svg)](https://saucelabs.com/u/idb-schema)

[![](https://img.shields.io/npm/v/idb-schema.svg)](https://npmjs.org/package/idb-schema)
[![](https://img.shields.io/travis/treojs/idb-schema.svg)](https://travis-ci.org/treojs/idb-schema)
[![](http://img.shields.io/npm/dm/idb-schema.svg)](https://npmjs.org/package/idb-schema)

This modules provides declarative schema management API for IndexedDB.
And it also fixes inconsistency between browsers:
- [Incorrect value of oldVersion in Safari](https://bugs.webkit.org/show_bug.cgi?id=136888) during `onupgradeneeded` event
- [InvalidAccessError in Internet Explorer](https://msdn.microsoft.com/en-us/library/hh772493(v=vs.85).aspx), when autoIncrement or keyPath are `false`

## Installation

    npm install --save idb-schema

Use [IndexedDBShim](https://github.com/axemclion/IndexedDBShim) to fallback to WebSQL.

## Example

```js
import Schema from 'idb-schema'

// define schema
const schema = new Schema()
.version(1)
  .addStore('books', { key: 'isbn' })
  .addIndex('byTitle', 'title', { unique: true })
  .addIndex('byAuthor', 'author')
.version(2)
  .getStore('books')
  .addIndex('byDate', ['year', 'month'])
.version(3)
  .addStore('magazines')
  .addIndex('byPublisher', 'publisher')
  .addIndex('byFrequency', 'frequency')
.version(4)
  .getStore('magazines')
  .delIndex('byPublisher')
  .addCallback((upgradeNeededEvent) => {
    // do something custom
  })

// get schema version
schema.version() // 4

// generate callback for db.onupgradeneeded event
schema.callback()

// get description of stores
schema.stores()
// [{ name: 'books', indexes: [{..}, {..}, {..}], keyPath: 'isbn' },
//  { name: 'magazines', indexes: [{..}] }]
```

## API

### schema.callback([errBack])

Generate `onupgradeneeded` callback.

```js
const req = indexedDB.open('mydb', schema.version())
req.onupgradeneeded = schema.callback()
req.onsuccess = (e) => {
  const db = e.target.result
}
```

Note that this callback will not support `addCallback` callbacks if they rely
on promises and run transactions (since `upgradeneeded`'s transaction will
expire). You can instead use `schema.open` or `schema.upgrade`.

`callback` takes an optional `errBack` function which is passed an error
object (upon encountering any errors during the upgrade) as well as the
`upgradeneeded` event.

```js
const schema = new Schema().version(1).delStore('nonexistentStore')
open(dbName, schema.version(), schema.callback(function errBack(err /* , e */) {
  throw new Error('Bad upgrade')
})).catch((err) => {
  console.log(err.message) // 'Bad upgrade'
})
```

If no `errBack` is provided, the error responsible will be thrown and can
be caught by the consuming code.

### schema.open(dbName, [version])

With `schema.open`, in addition to getting upgrades applied (including
callbacks added by `addCallback` and even including promise-based callbacks
which utilize transactions), you can use the `db` result opened at the
latest version:

```js
schema.open('myDb', 3).then((db) => {
  // Use db
})
```

However, unlike `callback()`, when `schema.open` is used, the callbacks
added by `addCallback` cannot handle operations such as adding stores
or indexes (though these operations can be executed with the other
methods of idb-schema anyways) though those added by `addEarlyCallback`
can be.

Besides conducting an upgrade, `schema.open` uses the `open` of
[idb-factory](https://github.com/treojs/idb-factory) behind the scenes, so
one can also catch errors and benefit from its fixing of browser quirks.

If a version is not supplied, the latest version available within the schema
will be used.

If you only wish to upgrade and do not wish to keep a connection open, use
`schema.upgrade`. If you wish to manage opening a connection yourself (and are
not using promises within `addCallback` callbacks), you can use
`schema.callback`.

Despite allowing for promise-based callbacks utilizing transactions, due to
[current limitations in IndexedDB](https://github.com/w3c/IndexedDB/issues/42),
we cannot get a transaction which encompasses both the store/index changes
and the store content changes, so it will not be possible to rollback the
entire version upgrade if the store/index changes transaction succeeds while
the store content change transaction fails. However, upon such a condition
idb-schema will set a `localStorage` property to disallow subsequent attempts
on `schema.open` or `schema.upgrade` to succeed until either the storage
property is manually flushed by the `flushIncomplete()` method or if the
`retry` method on the error object is invoked to return a Promise which will
reattempt to execute the failed callback and the rest of the upgrades and
which will resolve according to whether this next attempt was successful or
not.

### schema.upgrade(dbName, [version], [keepOpen=false])

Equivalent to `schema.open` but without keeping a connection open
(unless `keepOpen` is set to `true`):

```js
schema.upgrade('myDb', 3).then(() => {
  // No database result is available for upgrades. Use `schema.open` if you
  //   wish to keep a connection to the latest version open
  //   for non-upgrade related transactions
})
```

### schema.flushIncomplete(dbName)

If there was an incomplete upgrade, this method will flush the local storage
used to signal to `schema.open`/`schema.upgrade` that they should not yet allow
opening until the upgrade is complete. This method should normally not be used
as it is important to ensure an upgrade occurs like a complete transaction, and
flushing will interfere with this.

### schema.stores()

Get JSON representation of database schema.

```json
[
  {
    "name": "books",
    "indexes": [
      {
        "name": "byTitle",
        "field": "title",
        "multiEntry": false,
        "unique": true
      },
      {
        "name": "byAuthor",
        "field": "author",
        "multiEntry": false,
        "unique": false
      },
      {
        "name": "byDate",
        "field": [
          "year",
          "month"
        ],
        "multiEntry": false,
        "unique": false
      }
    ],
    "keyPath": "isbn",
    "autoIncrement": false
  },
  {
    "name": "magazines",
    "indexes": [
      {
        "name": "byFrequency",
        "field": "frequency",
        "multiEntry": false,
        "unique": false
      }
    ],
    "keyPath": null,
    "autoIncrement": false
  }
]
```

### schema.version([number])

Get current version or set new version to `number` and reset current store.
Use it to separate migrations on time.

### schema.addStore(name, [opts])

Create object store with `name`.

Options:
* `key` || `keyPath` - primary key (default: null)
* `increment` || `autoIncrement` - increment key automatically (default: false)

### schema.delStore(name)

Delete store by `name`.

Note that if a non-existent store is provided, this method will
not immediately throw (since it is possible one may wish to use this
for deleting stores added prior to using `idb-schema`). You will be
able to catch the errors, however:

```js
const schema = new Schema().version(1).delStore('nonexistentStore')
return open(dbName, schema.version(), schema.callback()).catch((err) => {
  console.log(err.name) // 'NotFoundError'
})
```

### schema.getStore(name)

Switch current store.
Use it to make operations with indexes.

### schema.addIndex(name, field, [opts])

Create index with `name` and to `field` (or array of fields).

Options:
* `unique` - (default: false)
* `multi` || `multiEntry` - (default: false)

### schema.delIndex(name)

Delete index by `name` from current store.

### schema.addEarlyCallback(cb)

Adds a `cb` to be executed at the beginning of the `upgradeneeded` event
and passed the event object. This will, out of necessity, run synchronously,
so promises cannot safely be used therein (whether used in `schema.callback`
or `schema.open`/`schema.upgrade`).

However, due to their early execution, such callbacks are, unlike
`addCallback` callbacks used with `schema.open`/`schema.upgrade`,
able to use methods such as `addStore`.

```js
const schema = new Schema()
.addStore('users', { increment: true, keyPath: 'id' })
.addIndex('byName', 'name')
.addEarlyCallback((e) => {
  schema.addIndex('byId', 'id')
})
```

### schema.addCallback(cb)

Adds a `cb` to be executed at the end of the `upgradeneeded` event
(if `schema.callback()` is used) or, at the beginning of the `success`
event (if `schema.open` and `schema.upgrade` are used). If `callback`
is used, the callback will be passed the `upgradeneeded` event. If
the other two methods are used, the db result will be passed instead.

```js
new Schema()
.addStore('users', { increment: true, keyPath: 'id' })
.addIndex('byName', 'name')
.addCallback((e) => {
  const users = e.target.transaction.objectStore('users')
  users.put({ name: 'Fred' })
  users.put({ name: 'Barney' })
})
```

Note that if you wish to use promises within such callbacks and make
transactions within them, your `addCallback` callback should return
a promise chain and then use `schema.open` or `schema.upgrade` because
these methods, unlike `schema.callback`, will cause the callbacks
to be executed safely within the more persistent `onsuccess` event (and the
callback will be passed the database result instead of the `upgradeneeded`
event). If you do not need promises, you will have the option of using
`schema.callback` in addition to `schema.open` or `schema.upgrade` (or
you can use `addEarlyCallback`).

### schema.clone()

Return a deep clone of current schema.

## License

[MIT](./LICENSE)
