import { db, saveChannels } from './store.js';

// runs once on a fresh install. two system channels by default.
// (names picked on purpose - no "dish" anywhere)
export function seedIfEmpty() {
  if (db.channels.length) return;
  db.channels = [
    {
      id: 'ch-prime',
      number: 100,
      name: 'WSTV Prime',
      tagline: 'The flagship web show channel — live, loud, unscripted',
      kind: 'system',
      ownerId: null,
      image: '',
      online: false,
      liveUrl: '',
      nextShowNote: '',
      breakVideos: [],
      schedule: [],
      createdAt: Date.now(),
    },
    {
      id: 'ch-loop',
      number: 101,
      name: 'WSTV Loop',
      tagline: 'Regular shows, reruns and everything in between',
      kind: 'system',
      ownerId: null,
      image: '',
      online: false,
      liveUrl: '',
      nextShowNote: '',
      breakVideos: [],
      schedule: [],
      createdAt: Date.now(),
    },
  ];
  saveChannels();
  console.log('[seed] created system channels: 100 WSTV Prime, 101 WSTV Loop');
}
