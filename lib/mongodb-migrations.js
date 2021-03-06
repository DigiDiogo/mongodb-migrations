// Generated by CoffeeScript 1.10.0
(function() {
  var Migrator, Promise, _, defaultLog, fs, migrationStub, mkdirp, mongoConnect, normalizeConfig, path, ref, repeatString,
    slice = [].slice;

  fs = require('fs');

  path = require('path');

  Promise = require('bluebird');

  _ = require('lodash');

  mkdirp = require('mkdirp');

  ref = require('./utils'), repeatString = ref.repeatString, mongoConnect = ref.connect, normalizeConfig = ref.normalizeConfig;

  migrationStub = require('./migration-stub');

  defaultLog = function() {
    var args, pad, src;
    src = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    pad = repeatString(' ', src === 'system' ? 4 : 2);
    return console.log.apply(console, [pad].concat(slice.call(args)));
  };

  Migrator = (function() {
    function Migrator(dbConfig, logFn) {
      dbConfig = normalizeConfig(dbConfig);
      this._isDisposed = false;
      this._m = [];
      this._result = {};
      this._dbReady = new Promise.fromCallback(function(cb) {
        return mongoConnect(dbConfig, cb);
      }).then((function(_this) {
        return function(db) {
          return _this._db = db;
        };
      })(this));
      this._collName = dbConfig.collection;
      this._timeout = dbConfig.timeout;
      if (logFn || logFn === null) {
        this.log = logFn;
      } else {
        this.log = defaultLog;
      }
    }

    Migrator.prototype.add = function(m) {
      return this._m.push(m);
    };

    Migrator.prototype.bulkAdd = function(array) {
      return this._m = this._m.concat(array);
    };

    Migrator.prototype._coll = function() {
      return this._db.collection(this._collName);
    };

    Migrator.prototype._runWhenReady = function(direction, cb, progress) {
      var onError, onSuccess;
      if (this._isDisposed) {
        return cb(new Error('This migrator is disposed and cannot be used anymore'));
      }
      onSuccess = (function(_this) {
        return function() {
          _this._ranMigrations = {};
          return _this._coll().find().toArray(function(err, docs) {
            var doc, j, len;
            if (err) {
              return cb(err);
            }
            for (j = 0, len = docs.length; j < len; j++) {
              doc = docs[j];
              _this._ranMigrations[doc.id] = true;
            }
            return _this._run(direction, cb, progress);
          });
        };
      })(this);
      onError = function(err) {
        return cb(err);
      };
      return this._dbReady.then(onSuccess, onError);
    };

    Migrator.prototype._run = function(direction, done, progress) {
      var allDone, handleMigrationDone, i, l, log, logFn, m, migrationsCollection, migrationsCollectionUpdatePromises, runOne, systemLog, userLog;
      if (direction === 'down') {
        m = _(this._m).reverse().filter((function(_this) {
          return function(m) {
            var _r, ref1;
            return (_r = (ref1 = _this._result[m.id]) != null ? ref1.status : void 0) && _r !== 'skip';
          };
        })(this)).value();
      } else {
        direction = (direction === 'forceDown') ? 'down' : 'up';
        this._result = {};
        m = this._m;
      }
      this._lastDirection = direction;
      logFn = this.log;
      log = function(src) {
        return function(msg) {
          return typeof logFn === "function" ? logFn(src, msg) : void 0;
        };
      };
      userLog = log('user');
      systemLog = log('system');
      i = 0;
      l = m.length;
      migrationsCollection = this._coll();
      migrationsCollectionUpdatePromises = [];
      handleMigrationDone = function(id) {
        var p;
        p = direction === 'up' ? Promise.fromCallback(function(cb) {
          return migrationsCollection.insert({
            id: id
          }, cb);
        }) : Promise.fromCallback(function(cb) {
          return migrationsCollection.deleteMany({
            id: id
          }, cb);
        });
        return migrationsCollectionUpdatePromises.push(p);
      };
      allDone = (function(_this) {
        return function(err) {
          return Promise.all(migrationsCollectionUpdatePromises).then(function() {
            return done(err, _this._result);
          });
        };
      })(this);
      runOne = (function(_this) {
        return function() {
          var context, fn, id, isCallbackCalled, migration, migrationDone, skipCode, skipReason, timeoutId;
          if (i >= l) {
            return allDone();
          }
          migration = m[i];
          i += 1;
          migrationDone = function(res) {
            var msg, ref1;
            _this._result[migration.id] = res;
            _.defer(function() {
              return typeof progress === "function" ? progress(migration.id, res) : void 0;
            });
            msg = "Migration '" + migration.id + "': " + res.status;
            if (res.status === 'skip') {
              msg += " (" + res.reason + ")";
            }
            systemLog(msg);
            if (res.status === 'error') {
              systemLog('  ' + res.error);
            }
            if (res.status === 'ok' || (res.status === 'skip' && ((ref1 = res.code) === 'no_up' || ref1 === 'no_down'))) {
              return handleMigrationDone(migration.id);
            }
          };
          fn = migration[direction];
          id = migration.id;
          skipReason = null;
          skipCode = null;
          if (!fn) {
            skipReason = "no migration function for direction " + direction;
            skipCode = "no_" + direction;
          }
          if (direction === 'up' && id in _this._ranMigrations) {
            skipReason = "migration already ran";
            skipCode = 'already_ran';
          }
          if (direction === 'down' && !(id in _this._result)) {
            //skipReason = "migration wasn't in the recent `migrate` run";
            //skipCode = 'not_in_recent_migrate';
          }
          if (skipReason) {
            migrationDone({
              status: 'skip',
              reason: skipReason,
              code: skipCode
            });
            return runOne();
          }
          isCallbackCalled = false;
          if (_this._timeout) {
            timeoutId = setTimeout(function() {
              var err;
              isCallbackCalled = true;
              err = new Error("migration timed-out");
              migrationDone({
                status: 'error',
                error: err
              });
              return allDone(err);
            }, _this._timeout);
          }
          context = {
            db: _this._db,
            log: userLog,
            extra: _this._extraContext
          };
          return fn.call(context, function(err) {
            if (isCallbackCalled) {
              return;
            }
            clearTimeout(timeoutId);
            if (err) {
              migrationDone({
                status: 'error',
                error: err
              });
              return allDone(err);
            } else {
              migrationDone({
                status: 'ok'
              });
              return runOne();
            }
          });
        };
      })(this);
      return runOne();
    };

    Migrator.prototype.addExtraContext = function (extraContext){
      this._extraContext = extraContext;
    };

    Migrator.prototype.migrate = function(done, progress) {
      this._runWhenReady('up', done, progress);
    };

    Migrator.prototype.rollback = function(done, progress) {
      this._runWhenReady('down', done, progress);
    };

    Migrator.prototype.forceRollback = function(done, progress) {
      this._runWhenReady('forceDown', done, progress);
    };

    Migrator.prototype._loadMigrationFiles = function(dir, cb) {
      return mkdirp(dir, 0x1fc, function(err) {
        if (err) {
          return cb(err);
        }
        return fs.readdir(dir, function(err, files) {
          if (err) {
            return cb(err);
          }
          files = files.filter(function(f) {
            var ref1;
            return ((ref1 = path.extname(f)) === '.js' || ref1 === '.coffee') && !f.startsWith('.');
          }).map(function(f) {
            var n, ref1;
            n = (ref1 = f.match(/^(\d+)/)) != null ? ref1[1] : void 0;
            if (n) {
              n = parseInt(n, 10);
            } else {
              n = null;
            }
            return {
              number: n,
              name: f
            };
          }).filter(function(f) {
            return !!f.name;
          }).sort(function(f1, f2) {
            return f1.number - f2.number;
          }).map(function(f) {
            var fileName;
            fileName = path.join(dir, f.name);
            if (fileName.match(/\.coffee$/)) {
              require('coffee-script/register');
            }
            return {
              number: f.number,
              module: require(fileName)
            };
          });
          return cb(null, files);
        });
      });
    };

    Migrator.prototype.runFromDir = function(dir, done, progress) {
      return this._loadMigrationFiles(dir, (function(_this) {
        return function(err, files) {
          if (err) {
            return done(err);
          }
          _this.bulkAdd(_.map(files, 'module'));
          return _this.migrate(done, progress);
        };
      })(this));
    };

    Migrator.prototype.create = function(dir, id, done, coffeeScript) {
      if (coffeeScript == null) {
        coffeeScript = false;
      }
      return this._loadMigrationFiles(dir, function(err, files) {
        var body, ext, fileName, maxNum, nextNum, ref1, ref2, slug;
        if (err) {
          return done(err);
        }
        maxNum = (ref1 = (ref2 = _.maxBy(files, 'number')) != null ? ref2.number : void 0) != null ? ref1 : 0;
        nextNum = maxNum + 1;
        slug = (id || '').toLowerCase().replace(/\s+/, '-');
        ext = coffeeScript ? 'coffee' : 'js';
        fileName = path.join(dir, nextNum + "-" + slug + "." + ext);
        body = migrationStub(id, coffeeScript);
        return fs.writeFile(fileName, body, done);
      });
    };

    Migrator.prototype.dispose = function(cb) {
      var onSuccess;
      this._isDisposed = true;
      onSuccess = (function(_this) {
        return function() {
          var e, error;
          try {
            _this._db.close();
            return typeof cb === "function" ? cb(null) : void 0;
          } catch (error) {
            e = error;
            return typeof cb === "function" ? cb(e) : void 0;
          }
        };
      })(this);
      return this._dbReady.then(onSuccess, cb);
    };

    return Migrator;

  })();

  module.exports.Migrator = Migrator;

}).call(this);
