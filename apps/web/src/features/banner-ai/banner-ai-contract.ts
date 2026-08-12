export const bannerPartRoles = [
  'background',
  'subject',
  'foreground',
  'decoration',
  'text',
  'other',
] as const;

export type BannerPartRole = (typeof bannerPartRoles)[number];

export interface BannerPartBounds {
  readonly xBps: number;
  readonly yBps: number;
  readonly widthBps: number;
  readonly heightBps: number;
}

export interface BannerAnalysisPart {
  readonly partKey: string;
  readonly label: string;
  readonly role: BannerPartRole;
  readonly bounds: BannerPartBounds;
}
export interface BannerLayerPreview {
  readonly partKey: string;
  readonly byteSize: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly sha256: string;
  readonly dataUrl: string;
}

export interface BannerAnalysisData {
  readonly source: {
    readonly displayFilename: string;
    readonly sourceMediaType: 'image/jpeg' | 'image/png';
    readonly normalizedMediaType: 'image/png';
    readonly normalizedByteSize: number;
    readonly width: number;
    readonly height: number;
    readonly sha256: string;
  };
  readonly proposal: {
    readonly kind: 'composition_proposal';
    readonly proposalVersion: 1;
    readonly parts: readonly BannerAnalysisPart[];
  };
  readonly extraction: {
    readonly previews: readonly BannerLayerPreview[];
    readonly provenance: 'deterministic fake / NOT_SAM_OUTPUT';
    readonly outboundNetwork: false;
    readonly dispatches: 3;
  };
  readonly provenance: {
    readonly fixture: {
      readonly capability: 'fixture_replay';
      readonly providerKey: 'fixture';
      readonly modelKey: 'phase1a-fixture-v1';
    };
    readonly workflow: {
      readonly workflowVersionId: string;
      readonly workflowVersion: number;
      readonly definitionSha256: string;
    };
    readonly policyVersion: 1;
    readonly external: false;
    readonly outboundNetworkEnabled: false;
    readonly estimatedCostMicros: '0';
    readonly currency: string;
    readonly elapsedMs: number;
    readonly ownership: {
      readonly mode: 'development-local';
      readonly requestId: string;
    };
  };
}

export type BannerAnalysisEnvelope =
  | { readonly ok: true; readonly data: BannerAnalysisData }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  return value;
};
const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void => {
  if (Object.keys(value).toSorted().join('|') !== [...keys].toSorted().join('|'))
    throw new TypeError(`${label} contains unexpected keys.`);
};

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length < 1) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
};

const integerValue = (value: unknown, label: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${label} must be a bounded integer.`);
  }
  return value as number;
};

const exactLiteral = <T extends string | number | boolean>(
  value: unknown,
  expected: T,
  label: string,
): T => {
  if (value !== expected) throw new TypeError(`${label} has an unexpected value.`);
  return expected;
};

const parseBounds = (value: unknown): BannerPartBounds => {
  const bounds = record(value, 'Part bounds');
  exactKeys(bounds, ['xBps', 'yBps', 'widthBps', 'heightBps'], 'Part bounds');
  const xBps = integerValue(bounds['xBps'], 'Part x position');
  const yBps = integerValue(bounds['yBps'], 'Part y position');
  const widthBps = integerValue(bounds['widthBps'], 'Part width', 1);
  const heightBps = integerValue(bounds['heightBps'], 'Part height', 1);
  if (
    xBps > 9_999 ||
    yBps > 9_999 ||
    widthBps > 10_000 ||
    heightBps > 10_000 ||
    xBps + widthBps > 10_000 ||
    yBps + heightBps > 10_000
  ) {
    throw new TypeError('Part bounds must fit inside the source image.');
  }
  return { xBps, yBps, widthBps, heightBps };
};

const parsePart = (value: unknown): BannerAnalysisPart => {
  const part = record(value, 'Composition part');
  exactKeys(part, ['partKey', 'label', 'role', 'bounds'], 'Composition part');
  const role = stringValue(part['role'], 'Composition part role');
  if (!bannerPartRoles.some((candidate) => candidate === role)) {
    throw new TypeError('Composition part role is not supported.');
  }
  return {
    partKey: stringValue(part['partKey'], 'Composition part key'),
    label: stringValue(part['label'], 'Composition part label'),
    role: role as BannerPartRole,
    bounds: parseBounds(part['bounds']),
  };
};
const parsePreview = (value: unknown): BannerLayerPreview => {
  const preview = record(value, 'Layer preview');
  exactKeys(
    preview,
    ['partKey', 'byteSize', 'pixelWidth', 'pixelHeight', 'sha256', 'dataUrl'],
    'Layer preview',
  );
  const dataUrl = stringValue(preview['dataUrl'], 'Layer preview data URL');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(dataUrl) || dataUrl.length > 700_000)
    throw new TypeError('Layer preview data URL is invalid or too large.');
  let decoded: string;
  try {
    decoded = atob(dataUrl.slice(22));
  } catch {
    throw new TypeError('Layer preview PNG is malformed.');
  }
  const payload = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (
    payload.byteLength < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => payload[index] === byte) ||
    new DataView(payload.buffer).getUint32(8) !== 13 ||
    String.fromCharCode(...payload.slice(12, 16)) !== 'IHDR' ||
    payload[24] !== 8 ||
    payload[25] !== 6 ||
    payload[26] !== 0 ||
    payload[27] !== 0 ||
    payload[28] !== 0
  )
    throw new TypeError('Layer preview PNG is malformed.');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const sha256 = stringValue(preview['sha256'], 'Layer preview digest');
  if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new TypeError('Layer preview digest is invalid.');
  const byteSize = integerValue(preview['byteSize'], 'Layer preview bytes', 1);
  const pixelWidth = integerValue(preview['pixelWidth'], 'Layer preview width', 1);
  const pixelHeight = integerValue(preview['pixelHeight'], 'Layer preview height', 1);
  if (
    byteSize > 524288 ||
    byteSize !== payload.byteLength ||
    pixelWidth > 160 ||
    pixelHeight > 160 ||
    width !== pixelWidth ||
    height !== pixelHeight
  )
    throw new TypeError('Layer preview metadata does not match PNG.');
  return {
    partKey: stringValue(preview['partKey'], 'Layer preview part'),
    byteSize,
    pixelWidth,
    pixelHeight,
    sha256,
    dataUrl,
  };
};

const parseData = (value: unknown): BannerAnalysisData => {
  const data = record(value, 'Analysis data');
  exactKeys(data, ['source', 'proposal', 'provenance', 'extraction'], 'Analysis data');
  const source = record(data['source'], 'Analysis source');
  exactKeys(
    source,
    [
      'displayFilename',
      'sourceMediaType',
      'normalizedMediaType',
      'normalizedByteSize',
      'width',
      'height',
      'sha256',
    ],
    'Analysis source',
  );
  const sourceMediaType = stringValue(source['sourceMediaType'], 'Source media type');
  if (sourceMediaType !== 'image/jpeg' && sourceMediaType !== 'image/png') {
    throw new TypeError('Source media type is not supported.');
  }

  const proposal = record(data['proposal'], 'Composition proposal');
  exactKeys(proposal, ['kind', 'proposalVersion', 'parts'], 'Composition proposal');
  if (
    !Array.isArray(proposal['parts']) ||
    proposal['parts'].length < 1 ||
    proposal['parts'].length > 5
  ) {
    throw new TypeError('Composition proposal must contain one to five parts.');
  }

  const parsedParts = proposal['parts'].map(parsePart);
  if (new Set(parsedParts.map((part) => part.partKey)).size !== parsedParts.length)
    throw new TypeError('Composition part keys must be unique.');
  const provenance = record(data['provenance'], 'Analysis provenance');
  exactKeys(
    provenance,
    [
      'fixture',
      'workflow',
      'policyVersion',
      'external',
      'outboundNetworkEnabled',
      'estimatedCostMicros',
      'currency',
      'elapsedMs',
      'ownership',
    ],
    'Analysis provenance',
  );
  const extraction = record(data['extraction'], 'Layer extraction');
  exactKeys(
    extraction,
    ['previews', 'provenance', 'outboundNetwork', 'dispatches'],
    'Layer extraction',
  );
  const previews = Array.isArray(extraction['previews'])
    ? extraction['previews'].map(parsePreview)
    : (() => {
        throw new TypeError('Layer previews must be an array.');
      })();
  const nonBackground = parsedParts.filter((part) => part.role !== 'background');
  if (
    previews.length !== nonBackground.length ||
    new Set(previews.map((preview) => preview.partKey)).size !== previews.length ||
    previews.some((preview) => !nonBackground.some((part) => part.partKey === preview.partKey))
  )
    throw new TypeError('Layer previews must exactly bind non-background parts.');
  const fixture = record(provenance['fixture'], 'Fixture provenance');
  exactKeys(fixture, ['capability', 'providerKey', 'modelKey'], 'Fixture provenance');
  const workflow = record(provenance['workflow'], 'Workflow provenance');
  exactKeys(
    workflow,
    ['workflowVersionId', 'workflowVersion', 'definitionSha256'],
    'Workflow provenance',
  );
  const ownership = record(provenance['ownership'], 'Ownership provenance');
  exactKeys(ownership, ['mode', 'requestId'], 'Ownership provenance');
  const elapsedMs = provenance['elapsedMs'];
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new TypeError('Analysis elapsed time must be a finite non-negative number.');
  }

  return {
    source: {
      displayFilename: stringValue(source['displayFilename'], 'Display filename'),
      sourceMediaType,
      normalizedMediaType: exactLiteral(
        source['normalizedMediaType'],
        'image/png',
        'Normalized media type',
      ),
      normalizedByteSize: integerValue(source['normalizedByteSize'], 'Normalized byte size', 1),
      width: integerValue(source['width'], 'Normalized width', 1),
      height: integerValue(source['height'], 'Normalized height', 1),
      sha256: stringValue(source['sha256'], 'Normalized digest'),
    },
    proposal: {
      kind: exactLiteral(proposal['kind'], 'composition_proposal', 'Proposal kind'),
      proposalVersion: exactLiteral(proposal['proposalVersion'], 1, 'Proposal version'),
      parts: parsedParts,
    },
    extraction: {
      previews,
      provenance: exactLiteral(
        extraction['provenance'],
        'deterministic fake / NOT_SAM_OUTPUT',
        'Extraction provenance',
      ),
      outboundNetwork: exactLiteral(extraction['outboundNetwork'], false, 'Extraction network'),
      dispatches: exactLiteral(extraction['dispatches'], 3, 'Extraction dispatches'),
    },
    provenance: {
      fixture: {
        capability: exactLiteral(fixture['capability'], 'fixture_replay', 'Fixture capability'),
        providerKey: exactLiteral(fixture['providerKey'], 'fixture', 'Fixture provider'),
        modelKey: exactLiteral(fixture['modelKey'], 'phase1a-fixture-v1', 'Fixture model'),
      },
      workflow: {
        workflowVersionId: stringValue(workflow['workflowVersionId'], 'Workflow identity'),
        workflowVersion: integerValue(workflow['workflowVersion'], 'Workflow version', 1),
        definitionSha256: stringValue(workflow['definitionSha256'], 'Workflow digest'),
      },
      policyVersion: exactLiteral(provenance['policyVersion'], 1, 'Policy version'),
      external: exactLiteral(provenance['external'], false, 'External-call flag'),
      outboundNetworkEnabled: exactLiteral(
        provenance['outboundNetworkEnabled'],
        false,
        'Outbound-network flag',
      ),
      estimatedCostMicros: exactLiteral(provenance['estimatedCostMicros'], '0', 'Estimated cost'),
      currency: stringValue(provenance['currency'], 'Cost currency'),
      elapsedMs,
      ownership: {
        mode: exactLiteral(ownership['mode'], 'development-local', 'Ownership mode'),
        requestId: stringValue(ownership['requestId'], 'Request identity'),
      },
    },
  };
};

export const parseBannerAnalysisEnvelope = (value: unknown): BannerAnalysisEnvelope => {
  const envelope = record(value, 'Analysis response');
  exactKeys(
    envelope,
    envelope['ok'] === false ? ['ok', 'error'] : ['ok', 'data'],
    'Analysis response',
  );
  if (envelope['ok'] === false) {
    const error = record(envelope['error'], 'Analysis error');
    exactKeys(error, ['code', 'message'], 'Analysis error');
    return {
      ok: false,
      error: {
        code: stringValue(error['code'], 'Analysis error code'),
        message: stringValue(error['message'], 'Analysis error message'),
      },
    };
  }
  if (envelope['ok'] !== true) throw new TypeError('Analysis response status is invalid.');
  return { ok: true, data: parseData(envelope['data']) };
};
