# Piscina-locks

Piscina-locks is an implementation of the [Web Locks API][] for Node.js.

The Web Locks API allows code to acquire a lock, perform work while the lock
is held, then have the lock automatically released when the work is complete.

Written using TypeScript and N-API.

For Node.js 12.x and higher.

[MIT Licensed][].

## Example

```js
const { request } = require('piscina-locks');
const { setTimeout } = require('timers/promises');

(async function() {
  return await request('resource', async (lock) => {
    await setTimeout(1000);
    return lock.name;
  });
})();
```

Using workers:

```js
const { request } = require('piscina-locks');
const { Worker, isMainThread } = require('worker_threads');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

request('shared-resource', async () => {
  console.log(isMainThread);
  await sleep(1000);
});

if (isMainThread) {
  // eslint-disable-next-line no-new
  new Worker(__filename);
}
```

## `request(name\[, options], callback)`

* `name` (`string`) The name of the lock to acquire.
* `options` (`object`)
  * `mode` (`string`) Must be `'exclusive'` or `'shared'`. Defaults to
    `'exclusive'`. There can be only one holder of an `'exclusive'`
    lock at a time but multiple holders of `'shared'` locks.
  * `ifAvailable` (`boolean`) When `true`, the request will fail if
    the lock cannot be granted immediately. Defaults to `false`.
  * `steal` (`boolean`) When `true`, any existing held locks are released
    and the associated Promises rejected with an `AbortError` and the
    requested lock will be granted. Defaults to `false`.
  * `signal` (`AbortSignal` | `EventEmitter`) An `AbortSignal` that can
    be used to cancel a pending lock request.
* `callback` (`function`) Invoked when the lock is acquired. The callback
  is invoked with the granted `Lock` as the only argument. If `ifAvailable`
  is `true` and the lock is not available, the argument will be `null`. The
  callback may be a regular function or an async function.

Returns a `Promise` that resolves with the return value of `callback` after
the granted `Lock` is released. The `Promise` will be rejected if the lock
request is canceled, the granted lock is stolen, or `callback` throws.

## `query()`

* Returns `object`
  * `pending` (`object[]`)
    * `name` (`string`)
    * `mode` (`string`)
  * `held` (`object[]`)
    * `name` (`string`)
    * `mode` (`string`)

The `query()` method is a diagnostic utility that lists the pending lock
requests and currently held locks. It is useful for debugging purposes only.

## The Team

* James M Snell <jasnell@gmail.com>

## Acknowledgements

Piscina development is sponsored by [NearForm Research][].

[MIT Licensed]: LICENSE.md
[NearForm Research]: https://www.nearform.com/research/
[Web Locks API]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
