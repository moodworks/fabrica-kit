export class BannerUploadFormError extends Error {
  readonly code: 'INVALID_UPLOAD_FORM';

  constructor(message: string) {
    super(message);
    this.name = 'BannerUploadFormError';
    this.code = 'INVALID_UPLOAD_FORM';
  }
}

export const requireSingleBannerUpload = (formData: FormData): File => {
  const entries = [...formData.entries()];
  if (entries.length === 0) {
    throw new BannerUploadFormError('Select exactly one JPG or PNG file.');
  }
  if (entries.some(([key]) => key !== 'file')) {
    throw new BannerUploadFormError(
      'Only the file field is accepted; actor and workspace authority are server-owned.',
    );
  }
  if (entries.length !== 1) {
    throw new BannerUploadFormError('Submit exactly one file value.');
  }
  const value = entries[0]?.[1];
  if (!(value instanceof File)) {
    throw new BannerUploadFormError('The file field must contain one uploaded file.');
  }
  return value;
};
