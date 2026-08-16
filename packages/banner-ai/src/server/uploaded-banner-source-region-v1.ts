import sharp from 'sharp';

export interface UploadedSourceRegionCropV1 {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export const materializeUploadedSourceRegionV1 = async (input: {
  readonly source: Uint8Array;
  readonly crop: UploadedSourceRegionCropV1;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}): Promise<Uint8Array> => {
  const { crop } = input;
  if (
    ![crop.left, crop.top, crop.width, crop.height].every(Number.isSafeInteger) ||
    crop.left < 0 ||
    crop.top < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.left + crop.width > input.sourceWidth ||
    crop.top + crop.height > input.sourceHeight
  )
    throw new TypeError('The source region is outside the uploaded image.');
  return Uint8Array.from(await sharp(input.source).extract(crop).png().toBuffer());
};
