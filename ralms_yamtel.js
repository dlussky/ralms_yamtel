/**
 * RALMS: Really Amazing Localstorage Mutex Solution
 *
 * @author dlussky
 *
 * @about
 * Based on the code presented by Benjamin Dumke-von der Ehe here:
 * http://balpha.de/2012/03/javascript-concurrency-and-locking-the-html5-localstorage/
 * which was based on the 1985 paper by Leslie Lamport:
 * http://research.microsoft.com/en-us/um/people/lamport/pubs/fast-mutex.pdf
 *
 * @usage:
 * window.RALMS.runExclusive(key, callback, maxDuration, maxWait);
 *
 * @license
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions
 * of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
 * TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */



(function () {
    var MUTEX_KEY_SUFFIX = "__storage_locker_mutex";
    var MUTEX_KEY_SUFFIX_X = "__storage_locker_mutex_x";
    var MUTEX_KEY_SUFFIX_Y = "__storage_locker_mutex_y";
    var LOG_PREFIX = "[RALMS] ";
    var MAX_ID = 2147483647;
    var MAX_VARTIME = 10;
    var MAX_CRIT_TIME = 100;
    var MAX_DURATION_DEFAULT = 5000;
    var MAX_WAIT_DEFAULT = 5000;
    var DEBUG = false;

    var RALMS = function RALMS() {
        if (!(this instanceof RALMS)) {
            return new RALMS();
        }

        this.waitTimeouts = {};
        this.id = _generateId();
    };

    var consoleLog = Function.prototype.bind.call(console.log, console);

    function _log(message) {
        if (DEBUG) {
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift(LOG_PREFIX);
            consoleLog.apply(console, args);
        }
    }

    function _now() {
        return (new Date()).getTime();
    }

    function _randomInt(maxInt) {
        return Math.random() * maxInt | 0;
    }

    function _generateId() {
        return _now() + ':' + _randomInt(MAX_ID);
    }

    function _generateTimedId(id, ttl) {
        return id + '|' + (_now() + ttl);
    }

    function _timedGetter(tskey) {
        return function () {
            var value = localStorage[tskey];
            if (!value) {
                return null;
            }

            var chunks = value.split(/\|/);
            if (parseInt(chunks[1]) < _now()) {
                return null;
            }
            return chunks[0];
        };
    }

    function _mutexTransaction(id, key, callback) {
        var xKey = key + MUTEX_KEY_SUFFIX_X,
            yKey = key + MUTEX_KEY_SUFFIX_Y,
            getY = _timedGetter(yKey);

        _log('_mutexTransaction started');

        function criticalSection() {
            try {
                _log('_mutexTransaction critical section');
                callback();
            } finally {
                localStorage.removeItem(yKey);
            }
        }

        function restart() {
            _log('_mutexTransaction restarting');
            setTimeout(function () {
                _mutexTransaction(id, key, callback);
            }, _randomInt(MAX_VARTIME));
        }

        localStorage[xKey] = id;
        if (getY()) {
            _log('_mutexTransaction RY fail');
            restart();
            return;
        }

        localStorage[yKey] = _generateTimedId(id, MAX_CRIT_TIME);

        if (localStorage[xKey] !== id) {
            _log('_mutexTransaction RX fail');
            setTimeout(function(){
                if (getY !== id) {
                    _log('_mutexTransaction RY2 fail');
                    restart();
                } else {
                    _log('_mutexTransaction RY2 win. Executing critical section');
                    criticalSection();
                }
            }, 5);
        } else {
            _log('_mutexTransaction RX win. Executing critical section');
            criticalSection();
        }
    }

    /**
     * Get a lock for specified key, and run callback exclusively among all tabs of current domain,
     * opened in same browser.
     * You can use this method recursively inside callback, but you'll need to use different keys for every
     * nesting level.
     *
     * @param key - operation identity
     * @param callback - function to be called
     * @param maxDuration - max duration of exclusive execution
     * @param maxWait - max timeout for waiting mutex
     */
    RALMS.prototype.runExclusive = function runExclusive(key, callback, maxDuration, maxWait) {
        maxDuration = maxDuration || MAX_DURATION_DEFAULT;
        maxWait = maxWait || MAX_WAIT_DEFAULT;

        if (!this.waitTimeouts[key]) {
            this.waitTimeouts[key] = _now() + maxWait;
        }

        var mutexKey = key + MUTEX_KEY_SUFFIX,
            getMutex = _timedGetter(mutexKey),
            mutexValue = _generateTimedId(this.id, maxDuration),
            self = this;

        _log('_runExclusive started');

        function restart() {
            if (_now() > self.waitTimeouts[key]) {
                _log('_runExclusive wait timeout exceeded');
                return;
            }
            _log('_runExclusive restarted');
            setTimeout(function () {
                self.runExclusive(key, callback, maxDuration);
            }, _randomInt(MAX_VARTIME));
        }

        if (getMutex()) {
            _log('_runExclusive pre-transaction mutex get fail');
            restart();
            return;
        }

        _mutexTransaction(this.id, key, function () {
            if (getMutex()) {
                _log('_runExclusive post-transaction mutex get fail');
                restart();
                return;
            }
            localStorage[mutexKey] = mutexValue;
            _log('_runExclusive mutex win');

            try {
                self.waitTimeouts[key] = null;
                _log('_runExclusive execution started for key ' + key);
                callback();
            } finally {
                _log('_runExclusive execution ended for key ' + key);
                _mutexTransaction(self.id, key, function () {
                    _log('_runExclusive removing mutex');
                    if (localStorage[mutexKey] !== mutexValue) {
                        throw key + " was locked by a different process while I held the lock";
                    }

                    localStorage.removeItem(mutexKey);
                });
            }
        });
    };

    window.RALMS = RALMS();
})();













/**
 * YAMTEL: Yet Another Master Tab Election Library
 *
 * @author dlussky
 *
 * @about
 * Messaging part is based on the Browbeat library by Simon Ljungberg:
 * https://github.com/simme/browbeat/
 *
 * @usage:
 * var Ymtl = new YAMTEL({
 *   'debug': true,
 *   'onBecameMaster': function (YAMTEL) {
 *     MyNotifications.startUpdating({'onUpdate':function(newData){
 *       YAMTEL.broadcast('notifications:updated', newData);
 *     }});
 *   },
 *   'onBecameSlave': function () {
 *     MyNotifications.stopUpdating();
 *   }
 * });
 *
 * Ymtl.on('notifications:updated', function(newData){
 *   MyNotifications.display(newData);
 * });
 *
 *
 * @license
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions
 * of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
 * TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

(function () {
    var HEARTBEAT_KEY = '_heartbeat';
    var CURRENT_KEY = '_currentMaster';
    var MSG_PREFIX = '_msg_';
    var KEY_PREFIX = '_yamtel_';
    var DEFAULT_INSTANCE = 'default';

    var LOG_PREFIX = "[YAMTEL] ";
    var MAX_ID = 2147483647;
    var MAX_TTL_DEVIATION = 500;
    var GC_OLD_MESSAGES_AGE = 2000;

    var YAMTELInstances = [];

    /**
     * YAMTEL: Yet Another Master Tab Election Library
     *
     * @param {Object} options                  Only considered, when creating the instance. When instance is acquired
     *                                          from instance cache, all options except instance name is ignored.
     *
     * @param options.instance                  Instance name
     * @param options.heartbeatTTL              How long tab will wait until assume that master tab is dead
     * @param options.gcLimit                   How many outdated messages would be deleted in one run
     * @param options.gcTimeout                 Garbage collection interval
     * @param options.debug                     Add debug messages
     * @param options.onBecameMaster function   Callback that would be called when the current tab becomes master
     * @param options.onBecameSlave function    Callback that would be called when the current tab becomes slave
     * @returns YAMTEL
     * @constructor
     */
    var YAMTEL = function YAMTEL(options) {
        options = options || {};

        this.instance = options.instance || DEFAULT_INSTANCE;

        if (!(this instanceof YAMTEL)) {
            if (!(YAMTELInstances[this.instance] instanceof YAMTEL)) {
                YAMTELInstances[this.instance] = new YAMTEL(options);
                YAMTELInstances[this.instance].log('new instance <' + this.instance + '> has been created');
            }

            YAMTELInstances[this.instance].log('instance <' + this.instance + '> will be returned from pool');
            return YAMTELInstances[this.instance];
        }

        this.log('new instance <' + this.instance + '> will be initialized');

        this.heartbeatTTL = 2000;

        this.debug = false;

        this.gcLimit = 100;

        this.gcTimeout = 7000;

        this.onBecameMaster = function(YAMTEL) {
            this.log('YAMTEL.onBecameMaster called for instance <' + YAMTEL.instance + '> with id <' + this.id + '>');
        };

        this.onBecameSlave = function(YAMTEL) {
            this.log('YAMTEL.onBecameSlave called for instance <' + YAMTEL.instance + '> with id <' + this.id + '>');
        };

        for (var key in options) if (options.hasOwnProperty(key) && this.hasOwnProperty(key)) {
            this[key] = options[key];
        }

        this.id = _generateId();
        this.gCollectorCursor = 0;
        this.storage = window.localStorage || false;
        this.isMaster = false;
        this.heartbeatTimer = null;
        this.gcTimer = null;
        this.listeners = {};
        this.heartbeatTTLOffset = _randomInt(MAX_TTL_DEVIATION);
        this.lastSentHeartbeat = 0;

        this.init();
    };

    /* Helpers */

    function _now() {
        return (new Date()).getTime();
    }

    function _randomInt(maxInt) {
        return Math.random() * maxInt | 0;
    }

    function _generateId() {
        return _randomInt(MAX_ID);
    }

    var consoleLog = Function.prototype.bind.call(console.log, console);

    YAMTEL.prototype.log = function log() {
        if (this.debug) {
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift(LOG_PREFIX);
            consoleLog.apply(console, args);
        }
    };

    YAMTEL.prototype.key = function key (key) {
        return KEY_PREFIX + this.instance + key;
    };

    YAMTEL.prototype.messageKey = function messageKey (key) {
        return MSG_PREFIX + '~' + key;
    };

    YAMTEL.prototype.write = function write (key, value) {
        this.storage.setItem(this.key(key), value);
    };
    YAMTEL.prototype.read = function read (key) {
        return this.storage.getItem(this.key(key));
    };

    /* Heartbeat related stuff */

    YAMTEL.prototype.heartbeat = function heartbeat() {
        var now = _now();
        if ((now - this.lastSentHeartbeat) > this.heartbeatTTL) {
            this.log('Our last heartbeat was too long ago. Becoming Slave.');
            this.becomeSlave();
            return;
        }
        this.updateHeartbeat();
        this.renewHeartbeatEmitTimer();
    };

    YAMTEL.prototype.updateHeartbeat = function updateHeartbeat() {
        var now = _now();
        this.write(HEARTBEAT_KEY, now);
        this.lastSentHeartbeat = now;
        this.log("I've updated the heartbeat for <" + this.instance + '> instance');
    };

    YAMTEL.prototype.heartbeatWatchdog = function heartbeatWatchdog() {
        this.log('Heartbeat watchdog fired');
        this.takeAChance();
    };

    YAMTEL.prototype.renewHeartbeatEmitTimer = function renewHeartbeatEmitTimer() {
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = setTimeout(this.heartbeat.bind(this), this.heartbeatTTL / 2);
    };

    YAMTEL.prototype.renewHeartbeatWatchdogTimer = function renewHeartbeatWatchdogTimer() {
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = setTimeout(this.heartbeatWatchdog.bind(this), this.heartbeatTTL + this.heartbeatTTLOffset);
    };


    /**
     * Initializes the YAMTEL object, sets up "storage" event handler and checking for heartbeat
     */
    YAMTEL.prototype.init = function init() {
        this.log('init: instance id ', this.id);

        // No store means no support, become the master
        if (!this.storage) {
            return this.becomeMaster();
        }

        // Hook up storage event listener
        var self = this;
        function handler(event) {
            self.storageEventHandler(event);
        }

        if (window.addEventListener) {
            window.addEventListener('storage', handler, false);
        } else {
            window.attachEventListener('storage', handler);
        }

        if (this.read(HEARTBEAT_KEY) > (_now() - this.heartbeatTTL)) {
            this.log('Found fresh heartbeat');
            this.becomeSlave();
        } else {
            this.log('No fresh hearthbeat, trying to become master');
            this.takeAChance();
        }
    };

    /**
     * Garbage collector
     *
     * Once in a while, master tab would run this method to run through the keys,
     * and delete all messages, that are older than a few seconds.
     * @internal
     */
    YAMTEL.prototype.gCollector = function gCollector() {
        var now = _now();
        var len = this.storage.length;
        var counter = 0;
        this.log('GC started');
        for (var i = this.gCollectorCursor; i < len && counter < this.gcLimit; i++) {
            var key = this.storage.key(i);
            if (key && key.indexOf(this.key(this.messageKey(''))) === 0) {
                var parts = key.split('~');
                if ((now - parseInt(parts[1], 10)) > GC_OLD_MESSAGES_AGE) {
                    this.storage.removeItem(key);
                    this.log('GC has removed', key);
                    i--;
                    counter++;
                }
            }
        }
        this.gCollectorCursor = (i >= len) ? 0 : i;
    };

    /**
     * Become master
     *
     * Becomes the master tab. Initiate heartbeat and emit event.
     * Also call the "onBecameMaster" callback from options
     * @internal
     */
    YAMTEL.prototype.becomeMaster = function becomeMaster() {
        this.log('Became master');
        this.isMaster = true;
        this.emit('becameMaster');

        if (this.storage) {
            this.renewHeartbeatEmitTimer();

            this.updateHeartbeat();

            // Garbage collect messages older then 2 seconds
            this.log('GC interval set');
            this.gcTimer = setInterval(this.gCollector.bind(this), this.gcTimeout);
        }

        if (typeof this.onBecameMaster == 'function') {
            this.onBecameMaster(this);
        }
    };

    /**
     * Become slave.
     *
     * Emit event, start heartbeat monitoring and try to become master if heartbeat stops.
     * Also call the "onBecameMaster" callback from options
     * @internal
     */
    YAMTEL.prototype.becomeSlave = function becomeSlave() {
        this.log('Became slave');
        this.isMaster = false;
        this.emit('becameSlave');

        clearInterval(this.gcTimer);

        if (this.storage) {
            this.renewHeartbeatWatchdogTimer();
        }

        if (typeof this.onBecameSlave == 'function') {
            this.onBecameSlave(this);
        }
    };

    /**
     * Try to become master tab
     * @internal
     */
    YAMTEL.prototype.takeAChance = function takeAChance() {
        var self = this;
        this.log('taking chances');
        RALMS.runExclusive(this.key('lock'), function () {
            if ((_now() - self.read(HEARTBEAT_KEY)) < self.heartbeatTTL) {
                self.log('heartbeat already updated. I lost.');
            } else {
                self.write(HEARTBEAT_KEY, _now());
                self.write(CURRENT_KEY, self.id);
                self.log('I won.');
                self.becomeMaster();
            }
        });
    };

    /**
     * Handle storage event
     *
     * The storage event is used as a message bus between all open tabs, so
     * this method acts as kind of a message dispatcher.
     * @param event
     * @internal
     */
    YAMTEL.prototype.storageEventHandler = function storageEventHandler(event) {
        var key = event.key;
        if (key.indexOf(this.key('')) !== 0) {
            return;
        }

        this.log('storage event', event.key, event.newValue);

        // Handle heartbeat events. Check for dead masters.
        if (!this.isMaster && key === this.key(HEARTBEAT_KEY)) {
            var self = this;
            this.log("The heartbeat for <" + self.instance + '> has been updated');
            this.renewHeartbeatWatchdogTimer();
            return;
        }

        if (this.isMaster && key === this.key(CURRENT_KEY) && Number(event.newValue) !== this.id) {
            this.log('current_key updated by someone else. I need to resign');
            this.becomeSlave();
        }

        if (event.newValue && key.indexOf(this.key(this.messageKey(''))) === 0) {
            var data = JSON.parse(event.newValue);
            if (!data) return;
            switch (data.message) {
                case 'master':
                    if (this.isMaster) {
                        this.emit('message', data.data);
                    }
                    break;
                case 'slave':
                    if (!this.isMaster) {
                        this.emit('message', data.data);
                    }
                    break;
                case 'broadcast':
                    this.emit('message', data.data);
                    break;
                default:
                    this.emit(data.message, data.data);
                    break;
            }
        }
    };

    /**
     * Custom event emitter functionality. Attach a handler to the given event.
     * @param e
     * @param handler function
     */
    YAMTEL.prototype.on = function on(e, handler) {
        if (!this.listeners[e]) {
            this.listeners[e] = [];
        }

        this.listeners[e].push(handler);
    };

    /**
     * Emits an event to the registered listeners.
     * @param e
     * @param data
     */
    YAMTEL.prototype.emit = function emit(e, data) {
        if (!this.listeners[e]) { return; }

        data = data || {};
        data.eventName = e;

        for (var i in this.listeners[e]) if (this.listeners[e].hasOwnProperty(i)) {
            this.listeners[e][i](data);
        }
    };

    /**
     * Removes the given event listener from the given event. The function
     * supplied here must be the exact same function supplied to `on()`.
     * @param e
     * @param handler
     */
    YAMTEL.prototype.off = function off(e, handler) {
        if (!this.listeners[e]) { return; }

        for (var i in this.listeners[e]) if (this.listeners[e].hasOwnProperty(i)) {
            if (this.listeners[e][i] === handler) {
                this.listeners[e].splice(i, 1);
                break;
            }
        }
    };

    /**
     * Broadcast a message to _all_ windows, including the sender.
     * @param message
     * @param data
     */
    YAMTEL.prototype.broadcast = function broadcast(message, data) {
        this.emit(message, data);
        this.sendMessage(message, data);
    };

    /**
     * Sends a message to the master only.
     * @param message
     */
    YAMTEL.prototype.messageMaster = function messageMaster(message) {
        if (this.isMaster) {
            this.emit('message', message);
        } else {
            this.sendMessage('master', message);
        }
    };

    /**
     * Sends a message to the slaves only.
     * @param message
     */
    YAMTEL.prototype.messageSlaves = function messageSlaves(message) {
        if (!this.isMaster) { this.emit('message', message); }
        this.sendMessage('slave', message);
    };

    /**
     * Sends a message on the "bus" to other tabs. The message is written to the
     * `localStorage`. The message will be garbage collected by the master at
     * some point.
     * @param message
     * @param data
     */
    YAMTEL.prototype.sendMessage = function sendMessage(message, data) {
        var msg = {
            message: message,
            data: data,
            timestamp: _now()
        };

        if (this.storage) {
            var key = this.messageKey(msg.timestamp + '~' + Math.random());
            this.write(key, JSON.stringify(msg));
            this.emit('sentMessage', [message, data]);
        } else {
            this.log('tried to send message. Failed because of lack of localStorage.');
        }
    };

    /** ------------------------------------------------------------------------- */

    window.YAMTEL = function(options) {
        return YAMTEL(options);
    };
}());

