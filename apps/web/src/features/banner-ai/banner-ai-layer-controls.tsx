export interface BannerAiLayerThumbnailView {
  readonly dataUrl: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export interface BannerAiLayerBoundsView {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BannerAiLayerControlPart {
  readonly partKey: string;
  readonly targetId: string;
  readonly name: string;
  readonly role: string;
  readonly bounds: BannerAiLayerBoundsView;
  readonly thumbnail: BannerAiLayerThumbnailView;
  readonly included: boolean;
  readonly visible: boolean | null;
}

export interface BannerAiLayerControlsProps {
  readonly parts: readonly BannerAiLayerControlPart[];
  readonly selectedPartId: string;
  readonly fixtureLabel?: string;
  readonly disabled?: boolean;
  readonly onSelectPart: (targetId: string) => void;
  readonly onSetPartIncluded: (targetId: string, included: boolean) => void;
  readonly onSetPartVisible: (targetId: string, visible: boolean) => void;
}

export function BannerAiLayerControls({
  parts,
  selectedPartId,
  fixtureLabel,
  disabled = false,
  onSelectPart,
  onSetPartIncluded,
  onSetPartVisible,
}: BannerAiLayerControlsProps) {
  return (
    <section className="editor-layer-controls" aria-labelledby="editor-layer-controls-title">
      <div className="editor-section-heading">
        <div>
          <p className="section-kicker">Scene layers</p>
          <h2 id="editor-layer-controls-title">Choose and configure a layer</h2>
        </div>
        <span>{parts.length} parts</span>
      </div>

      <fieldset className="editor-layer-fieldset" disabled={disabled}>
        <legend>Select one presentation part</legend>
        <p id="editor-layer-help">
          Inclusion and visibility are saved as a new accepted scene revision. Names and order stay
          fixed for this demo.
          {fixtureLabel === undefined ? null : ` ${fixtureLabel}`}
        </p>

        <ol className="editor-layer-list" aria-describedby="editor-layer-help">
          {parts.map((part, index) => {
            const isSelected = selectedPartId === part.targetId;
            const isBackground = part.targetId === 'background';
            const selectionId = `editor-layer-select-${index}`;
            const inclusionId = `editor-layer-include-${index}`;
            const visibilityId = `editor-layer-visible-${index}`;

            return (
              <li
                className={
                  isSelected ? 'editor-layer-row editor-layer-row-selected' : 'editor-layer-row'
                }
                key={part.targetId}
              >
                {/* These bounded, in-memory data URLs deliberately bypass image optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="editor-layer-thumbnail"
                  src={part.thumbnail.dataUrl}
                  alt=""
                  aria-hidden="true"
                  width="72"
                  height="48"
                />

                <div className="editor-layer-details">
                  <div className="editor-layer-selection">
                    <input
                      id={selectionId}
                      name="banner-ai-editor-selected-part"
                      type="radio"
                      checked={isSelected}
                      aria-describedby={`${selectionId}-state`}
                      onChange={() => onSelectPart(part.targetId)}
                    />
                    <label htmlFor={selectionId}>
                      <span className="editor-layer-name">{part.name}</span>
                      <span className="editor-layer-role">
                        {part.role} · {part.bounds.width} × {part.bounds.height} px
                      </span>
                    </label>
                  </div>

                  <p className="editor-layer-state" id={`${selectionId}-state`}>
                    <span>Selection: {isSelected ? 'selected' : 'not selected'}</span>
                    <span>Inclusion: {part.included ? 'included' : 'excluded'}</span>
                    <span>
                      Visibility:{' '}
                      {isBackground || part.visible === null
                        ? 'N/A · canvas background'
                        : part.visible
                          ? 'visible'
                          : 'hidden'}
                    </span>
                  </p>

                  <div className="editor-layer-toggles">
                    <div className="editor-layer-toggle">
                      <input
                        id={inclusionId}
                        type="checkbox"
                        checked={part.included}
                        onChange={(event) =>
                          onSetPartIncluded(part.targetId, event.currentTarget.checked)
                        }
                      />
                      <label htmlFor={inclusionId}>Include {part.name}</label>
                    </div>

                    {isBackground || part.visible === null ? (
                      <p className="editor-layer-visibility-na">
                        Visibility N/A · canvas background
                      </p>
                    ) : (
                      <div className="editor-layer-toggle">
                        <input
                          id={visibilityId}
                          type="checkbox"
                          checked={part.visible}
                          onChange={(event) =>
                            onSetPartVisible(part.targetId, event.currentTarget.checked)
                          }
                        />
                        <label htmlFor={visibilityId}>Show {part.name}</label>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </fieldset>
    </section>
  );
}
