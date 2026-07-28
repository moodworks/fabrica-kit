import { createAngelBenchmarkFixtureSourceV1 } from '@fabrica/banner-ai';

export const createRasterFile = (kind: 'jpeg' | 'png'): File => {
  const source = createAngelBenchmarkFixtureSourceV1(kind);
  const exactBytes = Uint8Array.from(source.bytes);
  return new File([exactBytes], source.filename, {
    type: source.declaredMediaType,
  });
};
