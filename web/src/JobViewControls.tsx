import { MenuToggle } from './ToolbarActions';

/** Job list view switches, as separate items for a toolbar's More menu. */
export default function jobViewItems({
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
  return [
    <MenuToggle key="audit" pressed={audit} icon="audit" onClick={onAudit}>
      Audit view
    </MenuToggle>,
    ...(showBatch
      ? [
          <MenuToggle key="group" pressed={grouped} icon="jobs" onClick={onGroup}>
            Group by checkout
          </MenuToggle>,
          <MenuToggle key="select" pressed={selecting} icon="complete" onClick={onSelect}>
            Select
          </MenuToggle>,
        ]
      : []),
  ];
}
