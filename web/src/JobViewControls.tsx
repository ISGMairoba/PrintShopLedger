import Icon from './Icon';

export default function JobViewControls({
  showBatch = true,
  audit,
  onAudit,
  grouped,
  selecting,
  onGroup,
  onSelect,
}: {
  showBatch?: boolean;
  audit: boolean;
  onAudit: () => void;
  grouped: boolean;
  selecting: boolean;
  onGroup: () => void;
  onSelect: () => void;
}) {
  return (
    <div className="job-view-controls">
      <button type="button" className="secondary" aria-pressed={audit} onClick={onAudit}>
        <Icon name={audit ? 'table' : 'audit'} /> {audit ? 'Normal view' : 'Audit view'}
      </button>
      {showBatch && (
        <>
          <button
            type="button"
            className="secondary job-view-button"
            aria-pressed={grouped}
            onClick={onGroup}
            title="Group by checkout"
          >
            <Icon name="jobs" /> Group by checkout
          </button>
          <button
            type="button"
            className="secondary job-view-button"
            aria-expanded={selecting}
            onClick={onSelect}
            title="Select items"
          >
            <Icon name="complete" /> Select
          </button>
        </>
      )}
    </div>
  );
}
