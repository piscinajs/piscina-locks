'use strict';

const { request } = require('../..');

let res;

const p = new Promise((resolve) => {
  res = resolve;
});

(async function () {
  setTimeout(res, 1000);

  // The lock can be held beyond the callback by using
  // an async function that returns a Promise that is
  // resolved later.
  const req = request('shared-resource', async () => {
    return p;
  });
  await req;
})();
