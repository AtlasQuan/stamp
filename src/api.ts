import express from 'express';
import { parseQuery, resize, sha256 } from './utils';
import { set, get, streamToBuffer, remove } from './aws';
import resolvers from './resolvers';
import constants from './constants.json';

const router = express.Router();

router.post('/:type/:id/delete', async (req, res) => {
  const { type, id } = req.params;
  const { sizes } = req.body;
  // also add the original image
  sizes.push({ w: constants.max, h: constants.max });

  try {
    if (sizes.length > 0) {
      await Promise.all(
        sizes.map(async size => {
          console.log(size);
          const { address, network, w, h } = await parseQuery(id, size);
          const key = sha256(JSON.stringify({ type, network, address, w, h }));
          remove(key);
          return;
        })
      );
    }

    res.status(200).end();
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/:type/:id', async (req, res) => {
  // Generate keys
  const { type, id } = req.params;
  const { address, network, w, h, cb } = await parseQuery(id, req.query);

  const key1 = sha256(
    JSON.stringify({ type, network, address, w: constants.max, h: constants.max })
  );
  const key2 = sha256(JSON.stringify({ type, network, address, w, h }));
  let currentResolvers = constants.resolvers.avatar;
  if (type === 'token') currentResolvers = constants.resolvers.token;

  let cache1;
  let cache2;

  // Check cache
  if (!cb) cache2 = await get(key2);
  if (cache2 && !cb) {
    console.log('Got cache', address);
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': `public, max-age=${constants.ttl}`,
      Expires: new Date(Date.now() + constants.ttl * 1e3).toUTCString()
    });
    return cache2.pipe(res);
  }

  if (!cb) cache1 = await get(key1);
  let file1;
  if (cache1 && !cb) {
    file1 = await streamToBuffer(cache1);
    console.log('Got base cache');
  } else {
    console.log('No cache for', key1, cache1);
    const p = currentResolvers.map(r => resolvers[r](address, network));
    const files = await Promise.all(p);
    files.forEach(file => {
      if (file) file1 = file;
    });
  }

  // Resize and return image
  const file2 = await resize(file1, w, h);
  res.set({
    'Content-Type': 'image/webp',
    'Cache-Control': `public, max-age=${constants.ttl}`,
    Expires: new Date(Date.now() + constants.ttl * 1e3).toUTCString()
  });
  res.send(file2);

  // Store cache
  try {
    if (!cache1) {
      await set(key1, file1);
      console.log('Stored base cache', key1);
    }
    await set(key2, file2);
    console.log('Stored cache', address);
  } catch (e) {
    console.log('Store cache failed', address, e);
  }
});

router.get('/*', async (req, res) => {
  res.redirect('https://github.com/snapshot-labs/stamp');
});

export default router;
