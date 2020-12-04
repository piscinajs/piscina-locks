import { request } from 'piscina-locks';
import { Worker, isMainThread } from 'worker_threads';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

request('shared-resource', async () => {
  console.log(isMainThread);
  await sleep(1000);
});

if (isMainThread) {
  // eslint-disable-next-line no-new
  new Worker(new URL('./index.mjs', import.meta.url));
}
