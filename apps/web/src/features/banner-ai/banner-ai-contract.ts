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

const parseData = (value: unknown): BannerAnalysisData => {
  const data = record(value, 'Analysis data');
  const source = record(data['source'], 'Analysis source');
  const sourceMediaType = stringValue(source['sourceMediaType'], 'Source media type');
  if (sourceMediaType !== 'image/jpeg' && sourceMediaType !== 'image/png') {
    throw new TypeError('Source media type is not supported.');
  }

  const proposal = record(data['proposal'], 'Composition proposal');
  if (
    !Array.isArray(proposal['parts']) ||
    proposal['parts'].length < 1 ||
    proposal['parts'].length > 5
  ) {
    throw new TypeError('Composition proposal must contain one to five parts.');
  }

  const provenance = record(data['provenance'], 'Analysis provenance');
  const fixture = record(provenance['fixture'], 'Fixture provenance');
  const workflow = record(provenance['workflow'], 'Workflow provenance');
  const ownership = record(provenance['ownership'], 'Ownership provenance');
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
      parts: proposal['parts'].map(parsePart),
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
  if (envelope['ok'] === false) {
    const error = record(envelope['error'], 'Analysis error');
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
