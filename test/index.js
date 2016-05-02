import 'indexeddbshim'
import ES6Promise from 'es6-promise'
import { expect } from 'chai'
import { pluck } from 'lodash'
import { del, open } from '../src/idb-factory'
import { request } from 'idb-request'
import Schema from '../src'

describe('idb-schema', function idbSchemaTest() {
  this.timeout(8000)
  ES6Promise.polyfill()
  const dbName = 'mydb'
  let db

  before(() => del(dbName))
  afterEach(() => {
    new Schema().flushIncomplete(dbName)
    return new Promise((res) => {
      setTimeout(() => {
        res(del(db || dbName).catch((err) => {
          return err.resume
        }))
      }, 500)
    })
  })

  it('describes database', () => {
    const schema = new Schema()
    .addStore('modules', { key: 'name' })
    .addIndex('byKeywords', 'keywords', { multiEntry: true })
    .addIndex('byAuthor', 'author', { unique: true })
    .addIndex('byRating', ['stars', 'position'])
    .addIndex('byMaintainers', 'maintainers', { multi: true })
    .addStore('users', { increment: true, keyPath: 'id' })
    .addCallback((e) => {
      const users = e.target.transaction.objectStore('users')
      users.put({ name: 'Fred' })
      users.put({ name: 'John' })
      users.put({ name: 'Barney' })
    })

    expect(schema.callback()).a('function')
    expect(schema.version()).equal(1)
    expect(schema.stores()[0].indexes).length(4)
    expect(schema.stores()[1]).eql({ name: 'users', indexes: [], keyPath: 'id', autoIncrement: true, copyFrom: null })

    return open(dbName, schema.version(), schema.callback()).then((originDb) => {
      db = originDb
      expect(db.version).equal(1)
      expect(Array.from(db.objectStoreNames)).eql(['modules', 'users'])

      const modules = db.transaction(['modules'], 'readonly').objectStore('modules')
      expect(modules.keyPath).equal('name')
      expect(Array.from(modules.indexNames).sort()).eql(
        ['byAuthor', 'byKeywords', 'byMaintainers', 'byRating'])

      const users = db.transaction(['users'], 'readonly').objectStore('users')
      expect(users.keyPath).equal('id')

      expect(modules.index('byMaintainers').unique).equal(false)
      expect(modules.index('byAuthor').unique).equal(true)

      // https://msdn.microsoft.com/en-us/library/hh772528(v=vs.85).aspx
      // https://msdn.microsoft.com/en-us/library/hh772573(v=vs.85).aspx
      if (modules.hasOwnProperty('autoIncrement')) {
        expect(users.autoIncrement).equal(true)
        expect(modules.autoIncrement).equal(false)
        expect(modules.index('byMaintainers').multiEntry).equal(true)
        expect(modules.index('byAuthor').multiEntry).equal(false)
      }

      return request(users.count()).then((count) => {
        expect(count).equal(3)
        db.close()
      })
    })
  })

  it('enables cascading migrations', () => {
    const schema = new Schema()
    .version(1)
      .addStore('books', { keyPath: 'isbn' })
      .addIndex('byTitle', 'title', { unique: true })
      .addIndex('byAuthor', 'author')
    .version(2)
      .getStore('books')
      .addIndex('byYear', 'year')
    .version(3)
      .addStore('magazines')
      .addIndex('byPublisher', 'publisher')
      .addIndex('byFrequency', 'frequency')

    return open(dbName, schema.version(), schema.callback()).then((originDb) => {
      db = originDb
      expect(db.version).equal(3)
      expect(Array.from(db.objectStoreNames)).eql(['books', 'magazines'])

      db.close()
      return new Promise((resolve) => setTimeout(resolve, 100)).then(() => {
        schema.version(4)
        .delStore('books')
        .getStore('magazines')
        .delIndex('byPublisher')

        return open(dbName, schema.version(), schema.callback()).then((originDb2) => {
          db = originDb2
          expect(db.version).equal(4)
          expect(Array.from(db.objectStoreNames)).eql(['magazines'])

          const magazines = db.transaction(['magazines'], 'readonly').objectStore('magazines')
          expect(Array.from(magazines.indexNames)).eql(['byFrequency'])
          db.close()
        })
      })
    })
  })

  it('#clone', () => {
    const schema1 = new Schema()
    .version(1)
      .addStore('books', { keyPath: 'isbn' })
      .addIndex('byTitle', 'title', { unique: true })
      .addIndex('byAuthor', 'author')
    .version(2)
      .getStore('books')
      .addIndex('byYear', 'year')

    const schema2 = schema1.clone()
    .version(3)
      .addStore('magazines')
      .addIndex('byPublisher', 'publisher')
      .addIndex('byFrequency', 'frequency')

    expect(schema1.version()).equal(2)
    expect(schema2.version()).equal(3)
    expect(pluck(schema1.stores(), 'name')).eql(['books'])
    expect(pluck(schema2.stores(), 'name')).eql(['books', 'magazines'])
  })

  it('validates arguments', () => {
    const schema = new Schema()
    .version(1)
      .addStore('books', { keyPath: 'isbn' })
      .addIndex('byTitle', 'title', { unique: true })
      .addIndex('byAuthor', 'author')
    .version(2)
      .getStore('books')
      .addIndex('byYear', 'year')

    // version
    expect(() => new Schema().version(0)).throws('invalid version')
    expect(() => new Schema().version(-1)).throws('invalid version')
    expect(() => new Schema().version(2.5)).throws('invalid version')
    expect(() => new Schema().version(Math.pow(2, 32))).throws('invalid version')

    // addStore
    expect(() => new Schema().addStore()).throws('"name" is required')
    expect(() => new Schema().addStore(101)).throws('"name" is required')
    expect(() => new Schema().addStore(101)).throws('"name" is required')
    expect(() => schema.addStore('books')).throws('"books" store is already defined')
    expect(() => new Schema().addStore('books', { autoIncrement: true, keyPath: '' })).throws('keyPath must not be the empty string or a sequence if autoIncrement is in use')
    expect(() => new Schema().addStore('books', { autoIncrement: true, keyPath: [] })).throws('keyPath must not be the empty string or a sequence if autoIncrement is in use')
    expect(() => new Schema().addStore('books', { autoIncrement: true, keyPath: ['isbn'] })).throws('keyPath must not be the empty string or a sequence if autoIncrement is in use')

    // delStore
    expect(() => new Schema().delStore()).throws('"name" is required')

    // getStore
    expect(() => new Schema().getStore()).throws('"name" is required')
    expect(() => new Schema().getStore('books')).throws('"books" store is not defined')

    // addIndex
    expect(() => new Schema().addStore('books').addIndex(null, 'title')).throws('"name" is required')
    expect(() => new Schema().addStore('books').addIndex('byTitle')).throws('"field" is required')
    expect(() => new Schema().addIndex('byTitle', 'title')).throws('set current store using "getStore" or "addStore"')
    expect(() => schema.addIndex('byTitle', 'title')).throws('"byTitle" index is already defined')

    // delIndex
    expect(() => schema.delIndex()).throws('"name" is required')
    expect(() => schema.delIndex('byField')).throws('"byField" index is not defined')
  })

  it('permissible edge cases', () => {
    expect(() => new Schema().addStore('books', { autoIncrement: true, keyPath: 'isbn' })).not.throws()
    expect(() => new Schema().addStore('books', { keyPath: '' })).not.throws()
    expect(() => new Schema().addStore('')).not.throws()

    const schema = new Schema().addStore('books')
    expect(() => schema.addIndex('', 'title')).not.throws()
    expect(() => schema.addIndex('author', '')).not.throws()
  })

  it('allows bad delStore to be catchable', () => {
    let ranErrBack = false
    const schema = new Schema()
    .version(1)
      .delStore('nonexistentStore')
    return open(dbName, schema.version(), schema.callback(null, function errBack(err /* , e */) {
      ranErrBack = true
      throw err
    })).catch((err) => {
      expect(err.name).equal('NotFoundError')
      expect(ranErrBack).equal(true)

      const schema2 = new Schema().version(2).delStore('nonexistentStore')
      return open(dbName, schema2.version(), schema2.callback()).catch((err2) => {
        expect(err2.name).equal('NotFoundError')
      })
    })
  })

  it('supports deletion and recreation of stores and indexes', () => {
    const schema = new Schema()
    .version(1)
      .addStore('books', { autoIncrement: false })
      .addStore('magazines')
      .addIndex('byAuthor', 'author', { unique: false })
    .version(2)
      .delStore('books')
      .addStore('books', { autoIncrement: true })
      .getStore('magazines')
      .delIndex('byAuthor')
      .addIndex('byAuthor', 'author', { unique: true })
    return open(dbName, schema.version(), schema.callback()).then((originDb) => {
      db = originDb
      const trans = db.transaction(['books', 'magazines'])

      const books = trans.objectStore('books')
      expect(books.autoIncrement).equal(true)

      const magazines = trans.objectStore('magazines')
      expect(magazines.indexNames.contains('byAuthor')).equal(true)
      const idx = magazines.index('byAuthor')
      expect(idx.unique).equal(true)

      originDb.close()
    })
  })

  it('supports an object store argument supplied to getStore', () => {
    const schema = new Schema()
    .version(1)
      .addStore('books')
    .version(2)
      .addEarlyCallback(function ecb(e) {
        const tr = e.target.transaction
        const os = tr.objectStore('books')
        schema.getStore(os)
        schema.addIndex('byYear', 'year')
      })
    return open(dbName, schema.version(), schema.callback()).then((originDb) => {
      db = originDb
      const trans = db.transaction(['books'])
      const store = trans.objectStore('books')
      expect(store.name).equal('books')
      expect(store.indexNames.contains('byYear')).equal(true)
      originDb.close()
    })
  })

  it('supports renameStore and copyStore (no content)', () => {
    const schema = new Schema()
    .version(1)
      .addStore('books')
      .addStore('magazines')
    .version(2)
      .renameStore('books', 'literature')
    .version(3)
      .copyStore('magazines', 'magazine-archive')

    return open(dbName, schema.version(), schema.callback()).then((originDb) => {
      db = originDb

      expect(db.objectStoreNames.contains('books')).equal(false)
      const trans = db.transaction(['magazines', 'literature', 'magazine-archive'])
      const magazines = trans.objectStore('magazines')
      expect(magazines.name).equal('magazines')
      const literature = trans.objectStore('literature')
      expect(literature.name).equal('literature')
      const magazineArchive = trans.objectStore('magazine-archive')
      expect(magazineArchive.name).equal('magazine-archive')
      originDb.close()
    })
  })

  it('supports renameStore and copyStore (with content)', () => {
    const schema = new Schema()
    .version(1)
      .addStore('books', { autoIncrement: true })
      .addStore('magazines', { autoIncrement: true })
      .addCallback((dbr) => {
        const trans = dbr.transaction(['books', 'magazines'], 'readwrite')
        const books = trans.objectStore('books')
        const magazines = trans.objectStore('magazines')
        return new Promise((resolve) => {
          const req = books.put({ name: 'World Peace through World Language', isbn: '1111111111' })
          req.onsuccess = () => {
            const req2 = magazines.put({ name: 'Popular Science' })
            req2.onsuccess = resolve
          }
        })
      })
    .version(2)
      .renameStore('books', 'literature')
    .version(3)
      .copyStore('magazines', 'magazine-archive')

    return schema.open(dbName, 3).then(function opened(originDb) {
      db = originDb

      expect(db.objectStoreNames.contains('books')).equal(false)
      const trans = db.transaction(['magazines', 'literature', 'magazine-archive'])
      const magazines = trans.objectStore('magazines')
      expect(magazines.name).equal('magazines')
      const literature = trans.objectStore('literature')
      expect(literature.name).equal('literature')
      const magazineArchive = trans.objectStore('magazine-archive')
      expect(magazineArchive.name).equal('magazine-archive')
      return new Promise((resolve) => {
        const req1 = magazines.getAll()
        req1.onsuccess = () => {
          const results = req1.result
          expect(results.length).equal(1)
          expect(results[0].name).equal('Popular Science')
          const req2 = literature.getAll()
          req2.onsuccess = () => {
            const results2 = req2.result
            expect(results2.length).equal(1)
            expect(results2[0].isbn).equal('1111111111')
            const req3 = magazineArchive.getAll()
            req3.onsuccess = () => {
              const results3 = req3.result
              expect(results3.length).equal(1)
              expect(results3[0].name).equal('Popular Science')
              originDb.close()
              resolve()
            }
          }
        }
      })
    })
  })

  describe('schema.open/schema.upgrade', () => {
    it('completes upgrade allowing for asynchronous callbacks', () => {
      let caught = false
      const schema = new Schema()
      .version(1)
        .addStore('books', { keyPath: 'isbn' })
        .addCallback((dbr) => {
          const books = dbr.transaction(['books'], 'readwrite').objectStore('books')
          return new Promise((resolve) => {
            books.put({ name: 'World Peace through World Language', isbn: '1111111111' })
            setTimeout(() => {
              const books2 = dbr.transaction(['books'], 'readwrite').objectStore('books')
              books2.put({ name: '1984', isbn: '2222222222' })
              resolve()
            }, 1000) // Ensure will not run before onsuccess if idb-schema code fails to wait for this promise
          })
        })
      .version(2)
        .addCallback((dbr) => {
          const trans = dbr.transaction(['books'], 'readwrite')
          const books = trans.objectStore('books')
          return new Promise((resolve) => {
            books.put({ name: 'History of the World', isbn: '1234567890' })
            setTimeout(() => {
              const books2 = dbr.transaction(['books'], 'readwrite').objectStore('books')
              books2.put({ name: 'Mysteries of Life', isbn: '2234567890' })
              resolve()
            }, 1000) // Ensure will not run before onsuccess if idb-schema code fails to wait for this promise
          })
        })
        .addCallback((dbr) => {
          const books = dbr.transaction(['books'], 'readwrite').objectStore('books')
          books.put({ name: 'Beginner Chinese', isbn: '3234567890' })
          return new Promise((resolve) => {
            setTimeout(() => {
              caught = true
              resolve()
            }, 1000) // Ensure will not run before onsuccess if idb-schema code fails to wait for this promise
          })
        })
        .addStore('journals')
      .version(3)
        .addStore('magazines')

      return schema.open(dbName, 3).then(function opened(originDb) {
        db = originDb
        const trans = db.transaction(['books', 'magazines'])
        const store = trans.objectStore('books')

        let missingStore = false
        try {
          trans.objectStore('magazines')
        } catch (err) {
          missingStore = true
        }
        expect(missingStore).equal(false)
        expect(caught).equal(true)
        return new Promise((resolve) => {
          const req1a = store.get('1111111111')
          req1a.onsuccess = e1a => {
            expect(e1a.target.result.name).equal('World Peace through World Language')
            const req1b = store.get('2222222222')
            req1b.onsuccess = e1b => {
              expect(e1b.target.result.name).equal('1984')
              const req2a = store.get('1234567890')
              req2a.onsuccess = e2a => {
                expect(e2a.target.result.name).equal('History of the World')
                const req2b = store.get('2234567890')
                req2b.onsuccess = e2b => {
                  expect(e2b.target.result.name).equal('Mysteries of Life')
                  const req2c = store.get('3234567890')
                  req2c.onsuccess = e2c => {
                    expect(e2c.target.result.name).equal('Beginner Chinese')
                    db.close()
                    resolve()
                  }
                }
              }
            }
          }
        })
      })
    })

    it('allows schema.upgrade to close connection', () => {
      const schema = new Schema()
      .version(1)
        .addStore('books', { keyPath: 'isbn' })
        .addCallback((dbr) => {
          return new Promise((resolve) => {
            const trans = dbr.transaction(['books'], 'readwrite')
            const books = trans.objectStore('books')
            books.put({ name: 'World Peace through World Language', isbn: '1111111111' })
            setTimeout(() => {
              const books2 = dbr.transaction(['books'], 'readwrite').objectStore('books')
              books2.put({ name: '1984', isbn: '2222222222' })
              resolve()
            }, 1000) // Ensure will not run before onsuccess if idb-schema code fails to wait for this promise
          })
        })
      return schema.upgrade(dbName, 3).then((noDb) => {
        expect(noDb).equal(undefined)
        return new Promise((resolve) => {
          setTimeout(() => {
            open(dbName, 3).then((dbr) => {
              expect(dbr.close).a('function')
              const trans = dbr.transaction('books')
              const store = trans.objectStore('books')
              const req1a = store.get('1111111111')
              req1a.onsuccess = e1a => {
                expect(e1a.target.result.name).equal('World Peace through World Language')
                const req1b = store.get('2222222222')
                req1b.onsuccess = e1b => {
                  expect(e1b.target.result.name).equal('1984')
                  dbr.close()
                  resolve()
                }
              }
            })
          }, 200)
        })
      })
    })

    it('allows user to resume after a bad schema.upgrade (bad sync callback)', () => {
      let ct = 0
      let resumedOk = false
      let caught = false
      let secondRan = false
      const schema = new Schema()
      .version(1)
        .addStore('books', { keyPath: 'isbn' })
        .addCallback((/* dbr */) => {
          ct++
          if (ct % 2) throw new Error('bad callback')
          resumedOk = true
        })
        .addCallback(() => {
          expect(resumedOk).equal(true)
          secondRan = true
        })
      return schema.upgrade(dbName).catch((err) => {
        expect(err.message).equal('bad callback')
        caught = true
        return err.retry()
      }).then((missingDb) => {
        expect(ct).equal(2)
        expect(caught).equal(true)
        expect(secondRan).equal(true)
        expect(missingDb).equal(undefined)
      })
    })

    it('allows user to resume after a bad schema.upgrade (bad async callback)', () => {
      let ct = 0
      let firstRan = false
      let thirdRan = false
      let caught = false
      const schema = new Schema()
      .version(1)
        .addStore('books', { keyPath: 'isbn' })
        .addCallback(() => {
          firstRan = true
        })
        .addCallback((/* dbr */) => {
          return new Promise((res, rej) => {
            setTimeout(() => {
              ct++
              if (ct % 2) rej('bad async callback')
              else res('ok')
            })
          })
        })
        .addCallback(() => {
          thirdRan = true
        })
      return schema.upgrade(dbName).catch((err) => {
        expect(err.message).equal('bad async callback')
        expect(firstRan).equal(true)
        expect(thirdRan).equal(false)
        caught = true
        return err.retry()
      }).then((missingDb) => {
        expect(thirdRan).equal(true)
        expect(caught).equal(true)
        expect(ct).equal(2)
        expect(missingDb).equal(undefined)
      })
    })

    it('allows user to resume after schema.upgrade is tried twice', () => {
      let ct = 0
      let firstRan = false
      let thirdRan = false
      let caught = false
      const schema = new Schema()
      .version(1)
        .addStore('books', { keyPath: 'isbn' })
        .addCallback(() => {
          firstRan = true
        })
        .addCallback((/* dbr */) => {
          return new Promise((res, rej) => {
            setTimeout(() => {
              ct++
              if (ct % 2) rej('bad async callback')
              else res('ok')
            })
          })
        })
        .addCallback(() => {
          thirdRan = true
        })
      return schema.upgrade(dbName).catch((err) => {
        expect(err.message).equal('bad async callback')
        expect(firstRan).equal(true)
        expect(thirdRan).equal(false)
        caught = true
      }).then(() => {
        expect(JSON.parse(localStorage.getItem('idb-incompleteUpgrades'))[dbName].version).equal(1)
        schema.upgrade(dbName).catch((err) => {
          return err.retry()
        }).then(() => {
          expect(JSON.parse(localStorage.getItem('idb-incompleteUpgrades'))[dbName]).equal(undefined)
          expect(thirdRan).equal(true)
          expect(caught).equal(true)
          expect(ct).equal(2)
        })
      })
    })

    it('allows user to resume after a bad schema.open', () => {
      let ct = 0
      let firstRan = false
      let thirdRan = false
      let caught = false
      const schema = new Schema()
      .version(1)
        .addStore('books', { keyPath: 'isbn' })
        .addCallback(() => {
          firstRan = true
        })
        .addCallback((/* dbr */) => {
          ct++
          if (ct % 2) throw new Error('bad callback')
          else return Promise.resolve('resumed ok')
        })
        .addCallback(() => {
          thirdRan = true
        })
      return schema.open(dbName).catch((err) => {
        expect(err.message).equal('bad callback')
        expect(firstRan).equal(true)
        expect(thirdRan).equal(false)
        caught = true
        return err.retry()
      }).then((originDb) => {
        originDb.close()
        expect(thirdRan).equal(true)
        expect(caught).equal(true)
        expect(ct).equal(2)
      })
    })
  })
})
