import { test } from 'node:test';
import assert from 'node:assert';
import { version as _version } from '../package.json';
import { EventEmitter } from 'events';
import { AbortController } from 'abort-controller';
import {
  request,
  query,
  version
} from '..';

function sleep (n : number) {
  return new Promise((resolve) => {
    setTimeout(resolve, n);
  });
}

test('request and query are exposed on export', async () => {
  assert.strictEqual(typeof request, 'function');
  assert.strictEqual(typeof query, 'function');
  assert.strictEqual(version, _version);
});

test('basically works', async () => {
  const ret = await request('test1', async (lock) => {
    assert.strictEqual(lock.name, 'test1');
    assert.strictEqual(lock.mode, 'exclusive');
    return 1;
  });
  assert.strictEqual(ret, 1);
});

test('shared locks work', async () => {
  const p1 = request('hello', { mode: 'shared' }, async () => {
    await sleep(10);
  });
  const p2 = request('hello', { mode: 'shared' }, async () => {
    await sleep(10);
  });
  await Promise.all([p1, p2]);
});

test('shared locks work reentrantly', async () => {
  const ret = await request('shared', { mode: 'shared' }, async () => {
    await request('shared', { mode: 'shared' }, async () => {
      await sleep(10);
    });
    return 1;
  });
  assert.strictEqual(ret, 1);
});

test('exclusive locks work non-reentrantly', async () => {
  const ac = new AbortController();
  const p = request('exclusive', async () => {
    await request('exclusive', { signal: ac.signal as any, mode: 'shared' }, async () => {
      await sleep(10);
    });
  });
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(p, /aborted/);
});

test('validates lock name is string', async () => {
  await assert.rejects(() => request((Symbol('') as any), () => {}),
    /Cannot convert a Symbol/);
});

test('validates callback is given', async () => {
  await assert.rejects(() => request(''), TypeError);
});

test('validates options is an object', async () => {
  await assert.rejects(() => request('', 'hi' as any, () => {}), TypeError);
  await assert.rejects(() => request('', 1 as any, () => {}), TypeError);
  await assert.rejects(() => request('', null as any, () => {}), TypeError);
  await assert.rejects(() => request('', undefined, () => {}), TypeError);
  await assert.rejects(() => request('', true as any, () => {}), TypeError);
});

test('validates options types', async () => {
  await assert.rejects(() => request('', { mode: 1 as any }, () => {}), RangeError);
  await assert.rejects(() => request('', { mode: 'foo' as any }, () => {}), RangeError);
  await assert.rejects(() => request('', { mode: true as any }, () => {}), RangeError);
  await assert.rejects(() => request('', { ifAvailable: 'yes' as any }, () => {}), TypeError);
  await assert.rejects(() => request('', { ifAvailable: 1 as any }, () => {}), TypeError);
  await assert.rejects(() => request('', { ifAvailable: {} as any }, () => {}), TypeError);
  await assert.rejects(() => request('', { steal: 1 as any }, () => {}), TypeError);
  await assert.rejects(() => request('', { steal: 'hi' as any }, () => {}), TypeError);
  await assert.rejects(() => request('', { steal: {} as any }, () => {}), TypeError);
});

test('generates a summary', async () => {
  const summary = query();
  assert.strictEqual(typeof summary, 'object');
  assert.ok(Array.isArray(summary.pending));
  assert.ok(Array.isArray(summary.held));
});

test('waits for lock to free', async () => {
  let check : boolean = false;
  const p1 = request('hello', async () => {
    await sleep(10);
    check = true;
  });
  const p2 = request('hello', async () => {
    assert.ok(check);
  });
  await Promise.all([p1, p2]);
});

test('waits for multiple locks to free', async () => {
  let firstCheck : boolean = false;
  let secondCheck : boolean = false;
  const p0 = request('hello', async () => {
    await sleep(10);
    firstCheck = true;
  });
  const p1 = request('hello', async () => {
    await sleep(10);
    secondCheck = true;
  });
  const p2 = request('hello', async () => {
    assert.ok(firstCheck);
    assert.ok(secondCheck);
  });
  await Promise.all([p0, p1, p2]);
});

test('cancels with AbortError', async () => {
  const unusedSignal = new EventEmitter();
  const p1 = request('hello', { signal: unusedSignal }, async () => {
    await sleep(10);
  });
  const signal = new EventEmitter();
  const p2 = request('hello', { signal }, async () => {});

  // We need to set up the rejection handler before emitting abort
  const p2Rejection = assert.rejects(p2, /aborted/);

  signal.emit('abort');

  await p1;
  await p2Rejection;

  assert.strictEqual(unusedSignal.listenerCount('abort'), 0);
});

test('cancels with AbortError (2)', async () => {
  const unusedAc = new AbortController();
  const p1 = request('hello', { signal: unusedAc.signal as any }, async () => {
    await sleep(10);
  });
  const ac = new AbortController();
  const p2 = request('hello', { signal: ac.signal as any }, async () => {});

  // We need to set up the rejection handler before aborting
  const p2Rejection = assert.rejects(p2, /aborted/);

  ac.abort();

  await p1;
  await p2Rejection;
});

test('fails when already aborted', async () => {
  const p1 = request('hello', { signal: { aborted: true } as any }, async () => {});
  await assert.rejects(p1, /aborted/);
});

test('lock null when not available', async () => {
  const p1 = request('hello', async () => {
    await sleep(10);
  });
  const p2 = request('hello', { ifAvailable: true }, async (lock) => {
    assert.strictEqual(lock, null);
  });

  await Promise.all([p1, p2]);
});
