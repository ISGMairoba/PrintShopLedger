import { MenuToggle } from './ToolbarActions';

/** Job list view switches, shown as items in a toolbar's More menu. */
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
    <>
      <MenuToggle pressed={audit} icon="audit" onClick={onAudit}>
        Audit view
      </MenuToggle>
      {showBatch && (
        <>
          <MenuToggle pressed={grouped} icon="jobs" onClick={onGroup}>
            Group by checkout
          </MenuToggle>
          <MenuToggle pressed={selecting} icon="complete" onClick={onSelect}>
            Select
          </MenuToggle>
        </>
      )}
    </>
  );
}
