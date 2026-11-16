import Icon from './Icon';
import ItemIcon from './ItemIcon';
import { TILE_COUNTS, generateTileColors, tileColors, tileLook, validateTiles } from './item-tiles.mjs';

type Tiles = ReturnType<typeof validateTiles>;

const SAMPLE = [
  ['book', 'Stationery'],
  ['shirt', 'Clothing'],
  ['mug', 'Gifts'],
  ['print', 'Printing'],
  ['bag', 'Packaging'],
  ['star', 'Other'],
  ['box', 'Stock'],
  ['tag', 'Labels'],
];

/**
 * Business Settings → Appearance → Item tiles: the colour of the icon area on Quick sale tiles.
 * Varied colours (by category or by item, 3–8 of them, generated from the brand colours, each
 * changeable) or one colour.
 */
export default function ItemTilesSettings({
  value,
  primary,
  accent,
  onChange,
}: {
  value: Tiles;
  primary: string;
  accent: string;
  onChange: (next: Tiles) => void;
}) {
  const tiles = validateTiles(value);
  const colors = tileColors(tiles, primary, accent);
  const set = (patch: Partial<Tiles>) => onChange({ ...tiles, ...patch });
  return (
    <section className="item-tiles-settings" aria-label="Item tiles">
      <h3>Quick sale item tiles</h3>
      <p className="muted">
        The coloured area behind each item's icon. Colours are made from your brand colours; dark mode uses
        deeper shades of the same colours.
      </p>
      <div className="form-grid">
        <label>
          Tile colours
          <select value={tiles.mode} onChange={(e) => set({ mode: e.target.value === 'single' ? 'single' : 'varied' })}>
            <option value="varied">Varied colours</option>
            <option value="single">One colour for all</option>
          </select>
        </label>
        {tiles.mode === 'varied' && (
          <>
            <label>
              Colour by
              <select value={tiles.by} onChange={(e) => set({ by: e.target.value === 'item' ? 'item' : 'category' })}>
                <option value="category">Category (items of a category share a colour)</option>
                <option value="item">Item (each item its own colour)</option>
              </select>
            </label>
            <label>
              Number of colours
              <select
                value={tiles.count}
                onChange={(e) => {
                  const count = Number(e.target.value);
                  // Own colours keep what fits; new places get generated colours.
                  const own = tiles.colors.length
                    ? [...tiles.colors, ...generateTileColors(primary, accent, count, tiles.seed)].slice(0, count)
                    : [];
                  set({ count, colors: own });
                }}
              >
                {TILE_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="tile-swatches" role="group" aria-label="Tile colours">
        {colors.map((color, index) => {
          const look = tileLook(color);
          const [icon, label] = SAMPLE[index % SAMPLE.length];
          return (
            <label key={index} className="tile-swatch" style={{ background: look.background, color: look.ink }}>
              <ItemIcon name={icon} />
              <small>{tiles.mode === 'varied' && tiles.by === 'category' ? label : `Colour ${index + 1}`}</small>
              {tiles.mode === 'varied' && (
                <input
                  type="color"
                  aria-label={`Tile colour ${index + 1}`}
                  value={color}
                  onChange={(e) => {
                    const next = [...colors];
                    next[index] = e.target.value;
                    set({ colors: next });
                  }}
                />
              )}
            </label>
          );
        })}
      </div>
      <div className="action-row">
        <button type="button" className="secondary" onClick={() => set({ seed: (tiles.seed + 1) % 1000000, colors: [] })}>
          <Icon name="restore" /> Generate again
        </button>
        {tiles.colors.length > 0 && (
          <button type="button" className="text-button" onClick={() => set({ colors: [] })}>
            Use generated colours
          </button>
        )}
      </div>
      <small className="muted">
        {tiles.mode === 'varied' ? 'Tap a colour to change it. ' : ''}Changing the brand colours changes generated
        tile colours too.
      </small>
    </section>
  );
}
