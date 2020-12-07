import { test } from 'tap';
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

test('request and query are exposed on export', async ({ is }) => {
  is(typeof request, 'function');
  is(typeof query, 'function');
  is(version, _version);
});

test('basically works', async ({ is }) => {
  const ret = await request('test1', async (lock) => {
    is(lock.name, 'test1');
    is(lock.mode, 'exclusive');
    return 1;
  });
  is(ret, 1);
});

test('shared locks work', async ({ resolves }) => {
  const p1 = request('hello', { mode: 'shared' }, async () => {
    await sleep(10);
  });
  const p2 = request('hello', { mode: 'shared' }, async () => {
    await sleep(10);
  });
  await resolves(Promise.all([p1, p2]));
});

test('shared locks work reentrantly', async ({ is }) => {
  const ret = await request('shared', { mode: 'shared' }, async () => {
    await request('shared', { mode: 'shared' }, async () => {
      await sleep(10);
    });
    return 1;
  });
  is(ret, 1);
});

test('exclusive locks work non-reentrantly', async ({ rejects }) => {
  const ac = new AbortController();
  const p = request('exclusive', async () => {
    await request('exclusive', { signal: ac.signal as any, mode: 'shared' }, async () => {
      await sleep(10);
    });
  });
  setTimeout(() => ac.abort(), 100);
  await rejects(p, /aborted/);
});

test('validates lock name is string', async ({ rejects }) => {
  rejects(() => request((Symbol('') as any), () => {}),
    /Cannot convert a Symbol/);
});

test('validates callback is given', async ({ rejects }) => {
  rejects(() => request(''), TypeError);
});

test('validates options is an object', async ({ rejects }) => {
  rejects(() => request('', 'hi' as any, () => {}), TypeError);
  rejects(() => request('', 1 as any, () => {}), TypeError);
  rejects(() => request('', null as any, () => {}), TypeError);
  rejects(() => request('', undefined, () => {}), TypeError);
  rejects(() => request('', true as any, () => {}), TypeError);
});

test('validates options types', async ({ rejects }) => {
  rejects(() => request('', { mode: 1 as any }, () => {}), RangeError);
  rejects(() => request('', { mode: 'foo' as any }, () => {}), RangeError);
  rejects(() => request('', { mode: true as any }, () => {}), RangeError);
  rejects(() => request('', { ifAvailable: 'yes' as any }, () => {}), TypeError);
  rejects(() => request('', { ifAvailable: 1 as any }, () => {}), TypeError);
  rejects(() => request('', { ifAvailable: {} as any }, () => {}), TypeError);
  rejects(() => request('', { steal: 1 as any }, () => {}), TypeError);
  rejects(() => request('', { steal: 'hi' as any }, () => {}), TypeError);
  rejects(() => request('', { steal: {} as any }, () => {}), TypeError);
});

test('generates a summary', async ({ is, ok }) => {
  const summary = query();
  is(typeof summary, 'object');
  ok(Array.isArray(summary.pending));
  ok(Array.isArray(summary.held));
});

test('waits for lock to free', async ({ resolves, ok }) => {
  let check : boolean = false;
  const p1 = request('hello', async () => {
    await sleep(10);
    check = true;
  });
  const p2 = request('hello', async () => {
    ok(check);
  });
  await resolves(Promise.all([p1, p2]));
});

test('cancels with AbortError', async ({ resolves, rejects, is }) => {
  const unusedSignal = new EventEmitter();
  const p1 = request('hello', { signal: unusedSignal }, async () => {
    await sleep(10);
  });
  const signal = new EventEmitter();
  const p2 = request('hello', { signal }, async () => {});
  signal.emit('abort');

  await Promise.all([
    resolves(p1),
    rejects(p2, /aborted/)
  ]);

  is(unusedSignal.listenerCount('abort'), 0);
});

test('cancels with AbortError (2)', async ({ resolves, rejects }) => {
  const unusedAc = new AbortController();
  const p1 = request('hello', { signal: unusedAc.signal as any }, async () => {
    await sleep(10);
  });
  const ac = new AbortController();
  const p2 = request('hello', { signal: ac.signal as any }, async () => {});
  ac.abort();

  await Promise.all([
    resolves(p1),
    rejects(p2, /aborted/)
  ]);
});

test('fails when already aborted', async ({ rejects }) => {
  const p1 = request('hello', { signal: { aborted: true } as any }, async () => {});
  await rejects(p1, /aborted/);
});

test('lock null when not available', async ({ resolves, is }) => {
  const p1 = request('hello', async () => {
    await sleep(10);
  });
  const p2 = request('hello', { ifAvailable: true }, async (lock) => {
    is(lock, null);
  });

  await Promise.all([
    resolves(p1),
    resolves(p2)
  ]);
});
