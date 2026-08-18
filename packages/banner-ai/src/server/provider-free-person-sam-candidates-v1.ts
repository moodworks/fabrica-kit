import { SamMaskCandidateSchema, type SamMaskCandidate } from '../sam/sam-mask-contracts.js';

const rawCandidates = [
  {
    order: 1,
    id: 'samc_v1_1ddb871238ba1ad8809e08647cb7d82208b675376c9e40339a2e27134e768c7f',
    bounds: { heightBps: 3439, widthBps: 1394, xBps: 8584, yBps: 0 },
    pixelArea: 5037,
    areaRatioBps: 260,
    scores: { predictedIouBps: 9766, stabilityScoreBps: 9735 },
    flags: ['near-contained', 'touches-source-edge'],
    mask: {
      sha256: 'c225461d9554d3f3cd10937df395ed70b844a0065a6ff468bc1748d8c66ae499',
      byteSize: 249,
      dataBase64:
        'RkJSTAEAAANsAAAA3QAAAACZkAZakAZcjwZcjwZcjwZcjwZckAZcjgZcjwZcjwZcjwZcjwZckAZbkAZbkAZbkAZbjwZcjwZcjwZcjwZcjwZckAZbkAZbjwZckAZbkAZbkAZbkAZbkAZbkAZbkAZbkAZbkAZbkQZakwZYlQZWlwZTmgZRnAZPngZOnwZMoQZJpAZHpgZFqAZDqwZArAY/rgY9sAY7sgY6swY3tgY1uAYzugYxvAYwvQYtwAYswgYoxAYoxQYlyAYjygYhzAYfzgYd0AYb0wYY1QYW1wYU2QYR2wYR3AYP3wYM4QYK4wYI5QYG5wYE+eAH',
    },
    cutout: {
      sha256: 'efa97f238a11d55d31e0438887bddece3de757f2b4abf117c8f1895553977022',
      byteSize: 5334,
      width: 122,
      height: 76,
    },
  },
  {
    order: 2,
    id: 'samc_v1_4e8c9ff354cdb17bc2d25595241cb40b27ebb2cafa3102d249bd92c16fe192e7',
    bounds: { heightBps: 9910, widthBps: 2512, xBps: 7488, yBps: 90 },
    pixelArea: 24269,
    areaRatioBps: 1253,
    scores: { predictedIouBps: 9766, stabilityScoreBps: 9600 },
    flags: ['near-contained', 'touches-source-edge'],
    mask: {
      sha256: '0b234db26618855b03219465322f964ce847b092bdf497413a19ae81ef3eca39',
      byteSize: 773,
      dataBase64:
        'RkJSTAEAAANsAAAA3QAAAAG76xMFvgcC6QYD5wYF5gYG5QYH5AYI4wYJ4gYK4QYL3wYN3gYO3gYO3QYP3QYP3QYP2wYR2QYT2QYT2AYU1wYV1QYX1AYY0wYZ0QYb0AYc0AYc0AYczwYdzwYdzgYezQYfywYhyQYjyQYjxwYlxgYmxAYowwYpwwYpwgYqwgYqwQYrwQYrvwYtvgYuvQYvvAYwuwYxuQYzuAY0tgY2tQY3tQY3tAY4tAY4swY5swY5sQY7sAY8rgY+rQY/rQY/qwZBqQZDqAZEpwZFpwZFpgZGpgZGpQZHpAZIogZKogZKoAZMngZOnQZPnAZQmwZRmgZSmQZTmQZTmAZUlwZVlgZWlQZXlAZYkwZZkgZakQZbkAZcjgZejQZfjAZgiwZhiwZhigZiiQZjhwZlhgZmhQZnhAZogwZpggZqgQZrgAZs/wVt/gVu/QVv/AVw+wVx+gVy+QVz+AV09wV19gV29QV39AV48gV68QV78QV78AV87wV97gV+7QV/7AWAAesFgQHqBYIB6QWDAegFhAHnBYUB5gWGAeUFhwHkBYgB4wWJAeEFiwHhBYsB4AWMAd4FjgHdBY8B3AWQAdwFkAHcBZAB2wWRAdoFkgHZBZMB2AWUAdcFlQHXBZUB1wWVAdgFlAHZBZMB2wWRAdoFkgHZBZMB2AWUAdQFmAHOBZ4BzAWgAcsFoQHJBaMByAWkAccFpQHGBaYBxQWnAcQFqAHDBakBwgWqAcEFqwHABawBvwWtAb4FrgG9Ba8BvAWwAbsFsQG6BbIBuQWzAbgFtAG3BbUBtgW2AbUFtwG0BbgBswW5AbIFugGxBbsBrwW9Aa4FvgGuBb4BrAXAAawFwAGrBcEBqgXCAagFxAGnBcUBpwXFAaYFxgGlBccBpAXIAaMFyQGiBcoBoAXMAaAFzAGfBc0BngXOAZ0FzwGcBdABmwXRAZoF0gGZBdMBmAXUAZcF1QGWBdYBlAXYAZQF2AGTBdkBkgXaAZEF2wGQBdwBkAV1Bg8rBCM=',
    },
    cutout: {
      sha256: '7055e5bb60c560727e151054d986a32ac81302fbc545c4f9979814c05ef503a2',
      byteSize: 20274,
      width: 220,
      height: 219,
    },
  },
  {
    order: 3,
    id: 'samc_v1_317598cd109a2db3bf18b665350d87c94c36adf73fe9691f5bc67c4559df7d5d',
    bounds: { heightBps: 6426, widthBps: 3596, xBps: 5468, yBps: 0 },
    pixelArea: 20574,
    areaRatioBps: 1062,
    scores: { predictedIouBps: 9727, stabilityScoreBps: 9596 },
    flags: ['touches-source-edge'],
    mask: {
      sha256: '0d5581cdad3c2dfb2b1d248be25b0289f48d989249dd2b946ed6b35984e805ac',
      byteSize: 730,
      dataBase64:
        'RkJSTAEAAANsAAAA3QAAAAIf3wOwArwErwK+BK0CwASrAsIEqQLEBKcCxgStAQpuyASpARJoygSmARZlzASiARxizQSfASBfzwScASNd0QSZASdZ1ASWASpY1QSTAS1V2ASRAS9T2gSOATJR3ASMATRQ3QSLATVO3wSJATdL4gSHATlK4wSGATlJ5QSFATpH5wSDATtG6gSBATxE7AR/PUPuBH49QfAEfj1A8gR9PT/0BHw9PvYEej4+9wR6PT35BHk9PfoEeD08/AR3PT38BHY9Pf0EEQJiPT79BA8EYT0//gQMCV48P/8ECwlePEH9BAsKXTxC/gQHDVw8Q/4EBg5bPUOSBVs8RIAFARJYPUaSBVc9RpMFVj1IkgVVPUmSBVU8SZIFVTxKkgVUPEuSBVM8TJMFUTxNlAVQO0//BAETTzpRkgVQOVKTBU45U5MFTThVkgVNOFaQBU82WI4FUTVZiwVTNFuDBVo0XIEFXDNcgQVcM12ABVwyXoAFXTFg/gRdMWL9BF0wY/wEXTBk/ARdL2X8BFwvZf0EXC9l/QRbMGb8BFoyZfwEWjFm/ARZMmX9BFkxZf4EWDJkgAVWNWCCBVU0YYMFVDVfhAVUNF+GBVM1XYgFUjZbigVRNlqMBU85V44FTzpUkAVNPlCSBUw/TpQFS0JJlwVKQ0eZBUlERpsFRkdDnQVFSUCeBURMPaAFQFE6ogU9VDikBThaNaYFNV0zqAUzXzGqBTBiL6wFLWQurgUqZyuxBSdpKrMFJWsotQUjbCe4BR9wJbgFH3AkugUdciK8BRxxIr4FGnEiwAUZciDBBRlyIMMFF3IexQUXch3HBRV0G8kFFHMazAUTchrPBQ90Gs8FD3QZ0gUMdxfTBQt4FdUFCXkT2QUGeBTaBQV4FNgGE9kGEt0GDt4GDd8GDN4GDN8GDOAGDOAGC+EGCuIGCOQGB+UGBuYGBecGBOkGAuWdBA==',
    },
    cutout: {
      sha256: '6d872d31e50ab3835b1d08423c4ca5f4f3ea7a500253b9fd272019746fb94f71',
      byteSize: 13204,
      width: 315,
      height: 142,
    },
  },
  {
    order: 4,
    id: 'samc_v1_231f84eb023346e92eb044887beb956b0bb18599cd3811f8e3ba6d6c1da79de6',
    bounds: { heightBps: 1403, widthBps: 1667, xBps: 4018, yBps: 6018 },
    pixelArea: 4504,
    areaRatioBps: 232,
    scores: { predictedIouBps: 9688, stabilityScoreBps: 9936 },
    flags: ['near-contained'],
    mask: {
      sha256: '2bc677e9750d3409eda1b3f77ec56860c37bd9bf68c8ce90313c65d6516f5c81',
      byteSize: 146,
      dataBase64:
        'RkJSTAEAAANsAAAA3QAAAAA//pAHjgHdBZAB2wWRAdsFkgHaBZIB2gWSAdoFkgHaBZIB2gWSAdoFkgHaBZIB2gWSAdoFkQHbBZIB2gWSAdoFkQHbBZIB2gWRAdsFkgHaBZEB2wWSAdoFkgHaBZEB2wWRAdsFkQHbBZEB2wWRAdsFkQHbBZEB2wWRAdwFjwGIiQM=',
    },
    cutout: {
      sha256: '2d30bd7d06d84f50bc4e7603120d97e7d9e3a3658578b5a638049fb0281809f4',
      byteSize: 6329,
      width: 146,
      height: 31,
    },
  },
  {
    order: 5,
    id: 'samc_v1_478780b81c47a3b064a5398bbf275ddd137a4e21d746b5aeb0623a7a546f99cf',
    bounds: { heightBps: 9729, widthBps: 1794, xBps: 6506, yBps: 271 },
    pixelArea: 17822,
    areaRatioBps: 920,
    scores: { predictedIouBps: 9648, stabilityScoreBps: 9644 },
    flags: ['near-contained', 'touches-source-edge'],
    mask: {
      sha256: '218f758d896e6f14198080c50705b1c7cf013b2902922596ee8fa8a2be0f75b0',
      byteSize: 675,
      dataBase64:
        'RkJSTAEAAANsAAAA3QAAAAG5nS4C5QYO3AYS2AYX0gYczQYhyQYlxQYowwYqwAYtvgYvuwYyugYzuAY1tgY2tgY3tQY4tAY4swY5swY6sQY7sQY7sQY7sAY8sQY7sQY7sQY7sQY7sQY7sQY7sQY7sgY6sgY6sgY6swY5swY5swY6sgY6swY6sQY6swY6sgY5swY5swY5swY4tQY3tQY3tQY3tQY3tgY1twY1twY0uQYzuQYyugYyuwYwvAYwvQYvvQYvvgYtvwYtvwYtwAYswAYrwQYswQYrwQYrwgYrwQYtwAYtvwYuvwYtvwYuvwYtvwYuvwYtvgYuvgYvvQYvvAYxuwYzuQY1twY3tQY6sgY7sAY+rgZArAZDqQZEpwZHpQZJoAZOmgZTlwZWlAZZjwZejAZhiQZjhwZmhQZnhAZpggZqgQZrgAZt/wVt/gVu/QVv/QVv/QVv/QVv/AVw/AVw+wVx+wVx+gVy+gVy+QVz+QVz+AV0+AV09wV19gV29gV29QV39QV39AV49AV48wV58wV58gV68gV68QV78AV88AV87wV87wV0AQfvBXQHAfAFc/gFdPgFc/gFc/kFc/gFdPcFdPcFdfcFdPUFd/QFd/UFd/QFePQFefIFe/AFfe0Ffu4Ffu0Ffu4Ffe0Ffu4Ffe8FfO4Ffu0Ffu4Ffe0Ffu0Ffu0Ffe0Ff+wFf+0Ffu0Ffu0Ffu4Ffe8FfO8FfPAFe/EFevIFefMFePQFd/UFdvYFdfcFdPgFc/kFcvoFcfsFb/4Fbv4Fbf8Fa4EGaoIGaoIGaYQGZ4UGZocGZIgGY4sGYI4GGgJBkQYSCT+VBgoOPq4GPa8GPLAGO7EGOrIGObMGN7YGNbcGNbcGNLkGMb0GLr8GLcAGKsMGKMUGJuAB',
    },
    cutout: {
      sha256: '464f1bb286ac4a599e3b49a25b1f427d2b73acaac6c2cd1829902d0d5a870c33',
      byteSize: 53742,
      width: 157,
      height: 215,
    },
  },
  {
    order: 6,
    id: 'samc_v1_1a0d692a155c4cfa1849c9c89b8b1d06aae8468b6b467a50f947ee9c8bab5846',
    bounds: { heightBps: 10000, widthBps: 10000, xBps: 0, yBps: 0 },
    pixelArea: 172741,
    areaRatioBps: 8922,
    scores: { predictedIouBps: 9492, stabilityScoreBps: 9507 },
    flags: ['near-contained', 'touches-source-edge'],
    mask: {
      sha256: '6609722c4e2735c0b2da642b062b205120a2d9b1de61d56f62beb5f8a11a73b1',
      byteSize: 900,
      dataBase64:
        'RkJSTAEAAANsAAAA3QAAAAJ5BwQCoQEEBTJqAgoFAwwCCXMCBYsBBQEMAgUBDUgKAesECQI1AjVICAQZAwr6BAcDMwUzAwIFAUAGBRcDCusTCd8GEtUGGtAGH8sGIsgGJr0GAwMqvAYzuwYxvAYxuwYyuQY0twY3tAY5sgY6sQY8rwY+rgY+rwY9rQZArQY/qwZBqwZBqgZCqwZBqwZBqwZArQYMATOrBg0BMqsGDgEzqwYNAjKrBg0BMqwGDQEyrQY+rgY/rgY+rQY/rgYYAyOwBgkBMbEGO7AGCgMxrwYJATOwBjyvBj2vBj6vBjywBjywBjyxBjuxBjuyBjqyBjqyBji0Bji0Bje1Bje1Bje2Bje1Bje1Bje1Bja2BjW3Bja3BjW2Bja3Bja2Bja2Bja1Bji3BjS2BjeyBgEENrYGN7YGNbgGNbgGNLkGM7kGNK8GAQY4tQY4swY5swY9rgZCqgZCqAZGoQYDA0WnBkikBkmdBlKaBlWVBliUBlmUBlmRBlyPBl+HBmaFBiEBRoIGaoIGaoIGIQRGgAZs/wVu/AVx+wVx+gVz+QVy+QVy+QV09wV1+QVz+QVz+AV19gV19wV09gV29gV29gV48wV68gV68gV48wV48AV78QV88QV+7gV+7gV+7gV87wV97wV78QV87wV97wV+7gWBAekFNgFJ7AU0A0/kBYYB5QWEAQEE4gWDAQQD4QV8AQ3iBYgB5QWBAeoFLAJT6gV4BgTqBS0CSQYE6QURBBgDSAgD5gV68QUzAUcKAuUFFwIWBUbxBTEERvEFMQRF8QUyAkjuBTUDR+oFNgNO5QU5A0wDAt8FggECAuYFggHpBYMB6QWDAekFggHpBYIB6QWDAegFgwHoBYIB6QWCAegFhAHnBYUB5gWDAegFhQHmBYYB5QWFAeYFbwQR6AWDAekFggHqBYEB6wWAAewFgAHrBYAB7AV/7gV+7QV+7gV88AV88AV78QV39QV29wV09wV19wV0+QVz+QVy+gVy+gVx+wVx+wVw/AVtgAZx/AVw/QVv/gVlBAWBBmCOBl2QBhIHQ6gGQ6kGQ6oGQasGQKwGQKwGP60GPrAGObQGN7YGM7oGMbsGMDoEAgQSAgoEBw0hAQ0BFg4LAuEEMDoECgMLAgwCCgYBAxIEAwMEAwsDCwIHEAEEBbIDAgQEBAENAXIfNAQJC8IB',
    },
    cutout: {
      sha256: '0e59f46cdb85ccdc5750dd63ea07f97115041213c8790357d8bc0aa9e3ea2cb2',
      byteSize: 179118,
      width: 876,
      height: 221,
    },
  },
  {
    order: 7,
    id: 'samc_v1_46f067c77f948ed582424e4ea53e19eccbaf69232855d17d5d45b56dfc7b9330',
    bounds: { heightBps: 1404, widthBps: 275, xBps: 410, yBps: 4343 },
    pixelArea: 668,
    areaRatioBps: 34,
    scores: { predictedIouBps: 9414, stabilityScoreBps: 9734 },
    flags: ['near-contained'],
    mask: {
      sha256: '0a54b3a200fa2a88822a93b6dc452b2172ae532579aa6e3dccdbae065603bc64',
      byteSize: 115,
      dataBase64:
        'RkJSTAEAAANsAAAA3QAAAAA/ppEFDtwGE9kGFdcGFdcGFtYGFtYGFtYGF9UGF9UGFtYGFtYGFtYGFtYGFdcGFdcGFdcGFtYGFtYGF9UGF9UGF9UGF9UGGNQGF9UGF9UGF9UGF9UGFtYGFdcGE9oGEN+JBQ==',
    },
    cutout: {
      sha256: '12777df90a03a2fc4561458ce7e724d55031d813388074b859efbfcc3ee05ed7',
      byteSize: 2030,
      width: 24,
      height: 31,
    },
  },
  {
    order: 8,
    id: 'samc_v1_784fbaff8569f318613712e39afd73d1520781509fac77d576207b36ace7a09b',
    bounds: { heightBps: 1766, widthBps: 675, xBps: 7214, yBps: 271 },
    pixelArea: 1243,
    areaRatioBps: 64,
    scores: { predictedIouBps: 9414, stabilityScoreBps: 9599 },
    flags: ['near-contained'],
    mask: {
      sha256: '1807624492b732a3b34ccb56dbb43355c9e859b3e75ea7fea1db7e936c3290c5',
      byteSize: 172,
      dataBase64:
        'RkJSTAEAAANsAAAA3QAAAABxmi4H4gYP2wYU1QYa0AYezAYiyAYlxQYowgYrwAYtvQYwuwYyuQY0uAY1twY2tQY3tQY4tAY4swY6sgY6sQY7sQYQAQcNFrEGCh0UsQYIIhGxBgclD7EGByUPsQYHJQ+xBgcmDrEGByYOsQYHJg6yBgYnDbIGBicNswYFKAyzBgUoDLMGBSkKtQYEKgm1BgMrCOUGBegGAv+1CQ==',
    },
    cutout: {
      sha256: '68f9fdc0811be915585506ff08e0651fc1ac742dc7a06026c9767a8af8664dda',
      byteSize: 3660,
      width: 59,
      height: 39,
    },
  },
];
export const PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1 = Object.freeze(
  SamMaskCandidateSchema.array().parse(
    rawCandidates.map((raw) => {
      const { id, order: ignoredOrder, scores, flags, cutout: ignoredCutout, ...candidate } = raw;
      void ignoredOrder;
      void ignoredCutout;
      return {
        ...candidate,
        candidateId: id,
        predictedIouBps: scores.predictedIouBps,
        stabilityScoreBps: scores.stabilityScoreBps,
        reviewFlags: flags,
        mask: { ...candidate.mask, encoding: 'fabrica-binary-rle-v1', width: 876, height: 221 },
      };
    }),
  ),
);
export const PROVIDER_FREE_PERSON_SAM_CUTOUTS_V1 = Object.freeze(
  new Map(rawCandidates.map((candidate) => [candidate.id, candidate.cutout] as const)),
);
export type ProviderFreePersonSamCandidateV1 = SamMaskCandidate & { readonly order: number };
