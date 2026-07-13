import type { SelectedBannerUpload } from './banner-ai-state';

const browserUploadLimitBytes = 20_971_520;
const browserRasterSideLimit = 4_096;
const browserRasterPixelLimit = 16_777_216;
const unsafeFilenamePattern = /[\p{Cc}\u202A-\u202E\u2066-\u2069/\\]/u;

const mediaTypeByExtension = Object.freeze({
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
} as const);

export interface BrowserRasterDimensions {
  readonly width: number;
  readonly height: number;
}

export type BrowserRasterDecoder = (previewUrl: string) => Promise<BrowserRasterDimensions>;

const validateFileIdentity = (file: File): 'image/jpeg' | 'image/png' => {
  if (
    file.name.length < 1 ||
    [...file.name].length > 120 ||
    file.name.normalize('NFC') !== file.name ||
    unsafeFilenamePattern.test(file.name)
  ) {
    throw new TypeError('Choose a file with a safe plain-text filename.');
  }
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const extensionMediaType = mediaTypeByExtension[extension as keyof typeof mediaTypeByExtension];
  if (extensionMediaType === undefined) {
    throw new TypeError('Choose a JPG, JPEG, or PNG file.');
  }
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
    throw new TypeError('The selected file must declare image/jpeg or image/png.');
  }
  if (extensionMediaType !== file.type) {
    throw new TypeError('The filename extension and image type do not match.');
  }
  if (file.size < 1) throw new TypeError('The selected image is empty.');
  if (file.size > browserUploadLimitBytes) {
    throw new TypeError('The selected image exceeds the 20 MiB upload limit.');
  }
  return file.type;
};

const validateDimensions = (dimensions: BrowserRasterDimensions): BrowserRasterDimensions => {
  const { width, height } = dimensions;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > browserRasterSideLimit ||
    height > browserRasterSideLimit ||
    width * height > browserRasterPixelLimit
  ) {
    throw new TypeError('Image dimensions must fit within 4096 × 4096 pixels.');
  }
  return dimensions;
};

export const decodeBrowserRasterDimensions: BrowserRasterDecoder = (previewUrl) =>
  new Promise<BrowserRasterDimensions>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      reject(new TypeError('The browser could not decode the selected JPG or PNG.'));
    };
    image.src = previewUrl;
  });

export const inspectBrowserRasterUpload = async (
  file: File,
  previewUrl: string,
  decode: BrowserRasterDecoder = decodeBrowserRasterDimensions,
): Promise<SelectedBannerUpload> => {
  const mediaType = validateFileIdentity(file);
  let dimensions: BrowserRasterDimensions;
  try {
    dimensions = validateDimensions(await decode(previewUrl));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError('The browser could not decode the selected JPG or PNG.');
  }
  return {
    filename: file.name,
    mediaType,
    originalByteSize: file.size,
    previewUrl,
    width: dimensions.width,
    height: dimensions.height,
  };
};
