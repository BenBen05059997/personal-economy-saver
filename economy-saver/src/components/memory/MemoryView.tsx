import { ApiForm } from "@/components/ui/ApiForm";
import { MEMORY_KIND_KEYS, MEMORY_KINDS, MEMORY_LIMIT, MEMORY_TEXT_MAX, type MemoryItem, type MemoryKind } from "@/lib/schema/memory";
import "./memory.css";

// Dates are the household's: a Try it household's rows carry its fixed date (D34), shown in its time zone.
export const dayIn = (timeZone: string) => (iso: string) => {
  const date = new Date(iso);
  const year = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", timeZone });
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone, ...(year(date) === year(new Date()) ? {} : { year: "numeric" }) });
};
export const howIn = (day: (iso: string) => string) => (item: MemoryItem) => item.madeBy === "ask" ? `Said in Ask · ${day(item.createdAt)}` : item.madeBy === "mcp" ? `Through MCP · ${day(item.createdAt)}` : `Added here · ${day(item.createdAt)}`;

export function KindSelect({ value }: { value?: MemoryKind }) {
  return <label className="ui-field">Kind
    <select name="memoryKind" defaultValue={value ?? "fact"}>
      {MEMORY_KIND_KEYS.map(key => <option key={key} value={key}>{MEMORY_KINDS[key].label}</option>)}
    </select>
  </label>;
}

function Item({ item, timeZone }: { item: MemoryItem; timeZone: string }) {
  const day = dayIn(timeZone), how = howIn(day);
  return <li className="memory-item">
    <p className="memory-text">{item.text}</p>
    <p className="ui-hint">{how(item)}{item.updatedAt !== item.createdAt && ` · edited ${day(item.updatedAt)}`}</p>
    <div className="memory-actions">
      <details className="memory-edit">
        <summary>Edit</summary>
        <ApiForm action="/api/memory">
          <input type="hidden" name="kind" value="edit" />
          <input type="hidden" name="returnTo" value="/memory" />
          <input type="hidden" name="id" value={item.id} />
          <KindSelect value={item.kind} />
          <label className="ui-field">What it knows<textarea name="text" required maxLength={MEMORY_TEXT_MAX} rows={3} defaultValue={item.text} /></label>
          <button className="ui-button primary">Save changes</button>
        </ApiForm>
      </details>
      <details className="memory-edit">
        <summary aria-label={`Delete: ${item.text}`}>Delete</summary>
        <ApiForm action="/api/memory">
          <input type="hidden" name="kind" value="delete" />
          <input type="hidden" name="returnTo" value="/memory" />
          <input type="hidden" name="id" value={item.id} />
          <p>Delete this for good? The assistant will no longer know it.</p>
          <button className="ui-button">Yes, delete</button>
        </ApiForm>
      </details>
    </div>
  </li>;
}

export function MemoryView({ items, timeZone }: { items: MemoryItem[]; timeZone: string }) {
  return <div className="memory-page">
    <header>
      <h1 className="ui-title">What the assistant knows</h1>
      <p className="ui-hint">This shapes how the assistant answers. It never changes your numbers.</p>
    </header>

    {items.length === 0 ? <section className="memory-empty ui-panel">
      <p>Nothing yet. When you tell the assistant something to keep, or add it here, it will appear in this list, where you can change or delete it.</p>
      <ul>{MEMORY_KIND_KEYS.map(key => <li key={key}><b>{MEMORY_KINDS[key].label}:</b> “{MEMORY_KINDS[key].example}”</li>)}</ul>
    </section> : MEMORY_KIND_KEYS.map(key => {
      const group = items.filter(item => item.kind === key);
      return group.length === 0 ? null : <section key={key} className="memory-group" aria-labelledby={`memory-${key}`}>
        <h2 id={`memory-${key}`}>{MEMORY_KINDS[key].label}</h2>
        <p className="ui-hint">{MEMORY_KINDS[key].help}</p>
        <ul>{group.map(item => <Item key={`${item.id}-${item.updatedAt}`} item={item} timeZone={timeZone} />)}</ul>
      </section>;
    })}

    <section className="memory-add ui-panel">
      <h2>Add something</h2>
      <ApiForm key={items.length} action="/api/memory">
        <input type="hidden" name="kind" value="add" />
        <input type="hidden" name="returnTo" value="/memory" />
        <KindSelect />
        <label className="ui-field">What should it know?<textarea name="text" required maxLength={MEMORY_TEXT_MAX} rows={3} placeholder="e.g. Rent goes up in April" /></label>
        <button className="ui-button primary">Add</button>
      </ApiForm>
      <p className="ui-hint">{items.length} of {MEMORY_LIMIT} used.</p>
    </section>

    {items.length > 0 && <section className="memory-forget">
      <details className="memory-edit">
        <summary>Forget everything</summary>
        <ApiForm action="/api/memory">
          <input type="hidden" name="kind" value="forget_all" />
          <input type="hidden" name="returnTo" value="/memory" />
          <p>Delete all {items.length} {items.length === 1 ? "thing" : "things"} for good? This cannot be undone.</p>
          <button className="ui-button">Yes, forget everything</button>
        </ApiForm>
      </details>
    </section>}
  </div>;
}
