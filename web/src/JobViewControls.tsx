import Icon from './Icon';

export default function JobViewControls({
  grouped,
  selecting,
  onGroup,
  onSelect,
}: {
  grouped: boolean;
  selecting: boolean;
  onGroup: () => void;
  onSelect: () => void;
}) {
  return (
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
  );
}
