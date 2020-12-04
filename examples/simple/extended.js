'use strict';

const { request } = require('../..');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

let resolve;

const p = new Promise((res) => resolve = res);

(async function() {
  setTimeout(resolve, 1000);

  // The lock can be held beyond the callback by using
  // an async function that returns a Promise that is
  // resolved later.
  const req = request('shared-resource', async () => {
    return p;
  });
  await req;
})();
