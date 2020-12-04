'use strict';

const { request } = require('../..');
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
