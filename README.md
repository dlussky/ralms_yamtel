# Really Amazing Localstorage Mutex Solution &amp; Yet Another Master Tab Election Library
A very old library to elect master tab and allow it to communicate to slaves (usually used to reduce polling load or number of websocket connections when every tab needs to recieve notifications). At the time every lib I've tested showed very unstable election behavior when number of tabs exceeded 10-15. This solution is very robust and showed much better results. Multi-instance setup was designed, but not tested, so beware)

## RALMS: Really Amazing Localstorage Mutex Solution
Based on the code presented by Benjamin Dumke-von der Ehe here: http://balpha.de/2012/03/javascript-concurrency-and-locking-the-html5-localstorage/ which was in turn based on the 1985 paper by Leslie Lamport: http://research.microsoft.com/en-us/um/people/lamport/pubs/fast-mutex.pdf

Usage:
```jslog
//key - operation identity
//callback - function to be called when the mutex is acquired
//maxDuration - max duration of exclusive execution
//maxWait - max timeout for waiting mutex
window.RALMS.runExclusive(key, callback, maxDuration, maxWait);
```

## YAMTEL: Yet Another Master Tab Election Library
Messaging part is based on the Browbeat library by Simon Ljungberg: https://github.com/simme/browbeat/

Usage:
```js
var Ymtl = new YAMTEL({
  'instance': 'my-notifications',
  'debug': true,
  'onBecameMaster': function (YAMTEL) {
    MyNotifications.startUpdating({'onUpdate':function(newData){
      YAMTEL.broadcast('notifications:updated', newData);
    }});
  },
  'onBecameSlave': function () {
    MyNotifications.stopUpdating();
  }
});
Ymtl.on('notifications:updated', function(newData){
  MyNotifications.display(newData);
});
```
