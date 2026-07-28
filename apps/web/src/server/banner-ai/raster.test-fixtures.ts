import { createAngelBenchmarkFixtureSourceV1 } from '@fabrica/banner-ai';

export const createRasterFile = (kind: 'jpeg' | 'png'): File => {
  const source = createAngelBenchmarkFixtureSourceV1(kind);
  return new File([Uint8Array.from(source.bytes)], source.filename, {
    type: source.declaredMediaType,
  });
};
