import { parseBannerAnalysisEnvelope, type BannerAnalysisData } from './banner-ai-contract';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class BannerAnalysisRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BannerAnalysisRequestError';
  }
}

export const requestLocalFixtureAnalysis = async (
  file: File,
  fetchImplementation: FetchLike = fetch,
): Promise<BannerAnalysisData> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetchImplementation('/api/banner-ai/analyze', {
    method: 'POST',
    body: formData,
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BannerAnalysisRequestError('The local analysis response was not valid JSON.');
  }

  let envelope;
  try {
    envelope = parseBannerAnalysisEnvelope(payload);
  } catch {
    throw new BannerAnalysisRequestError('The local analysis response was not valid.');
  }
  if (!envelope.ok) throw new BannerAnalysisRequestError(envelope.error.message);
  if (!response.ok) {
    throw new BannerAnalysisRequestError('The local fixture analysis could not be completed.');
  }
  return envelope.data;
};
