"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EntityType, Note, NoteSummary } from "@stratamem/sdk";
import { mergeNote, saveNote } from "@/app/actions";
import { displayName, TYPE_ORDER, typeColor } from "@/lib/format";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Right-panel properties (Obsidian-style frontmatter), editable, plus "same as another note" merge. */
export function NoteProperties({ note, others }: { note: Note; others: NoteSummary[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(note.name);
  const [type, setType] = useState(note.type);
  const [aliases, setAliases] = useState(note.aliases.join(", "));
  const [tags, setTags] = useState(note.tags.join(", "));
  const [mergeOpen, setMergeOpen] = useState(false);
  const [into, setInto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const r = await saveNote(note.id, { name, type: type as EntityType, aliases: list(aliases), tags: list(tags) });
      if (r.error) setError(r.error);
      else (setError(null), setEditing(false));
    });

  const merge = () =>
    start(async () => {
      const r = await mergeNote(note.id, into);
      if (r.error) setError(r.error);
      else router.push(`/notes/${into}`);
    });

  const row = "grid grid-cols-[72px_1fr] items-baseline gap-2 py-1";
  const field = "w-full rounded-md border border-line-strong bg-sunk px-2 py-1 text-[13px] outline-none focus:border-ochre";

  return (
    <section className={pending ? "opacity-60" : ""}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-soft">Properties</h2>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-[12.5px] text-muted hover:text-ochre">
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2 text-[13px]">
          <label className="block">
            <span className="text-muted">Name</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-muted">Type</span>
            <select className={field} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-muted">Aliases (comma separated)</span>
            <input className={field} value={aliases} onChange={(e) => setAliases(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-muted">Tags (comma separated)</span>
            <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <div className="flex gap-2 pt-1">
            <button onClick={save} className="rounded-md bg-ochre px-3 py-1 font-medium text-sunk">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="rounded-md px-3 py-1 text-muted hover:text-text">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <dl className="text-[13px]">
          <div className={row}>
            <dt className="text-muted">Type</dt>
            <dd className="flex items-center gap-1.5">
              <span className="size-[7px] rounded-full" style={{ background: typeColor(note.type) }} />
              {note.type}
            </dd>
          </div>
          <div className={row}>
            <dt className="text-muted">Aliases</dt>
            <dd className="text-soft">{note.aliases.length ? note.aliases.join(", ") : <span className="text-faint">none</span>}</dd>
          </div>
          <div className={row}>
            <dt className="text-muted">Tags</dt>
            <dd className="flex flex-wrap gap-1">
              {note.tags.length ? (
                note.tags.map((t) => (
                  <span key={t} className="rounded bg-raised px-1.5 text-[12px] text-soft">
                    #{t}
                  </span>
                ))
              ) : (
                <span className="text-faint">none</span>
              )}
            </dd>
          </div>
        </dl>
      )}

      {error && <p className="mt-2 text-[12.5px] text-cinnabar">{error}</p>}

      <div className="mt-3 border-t border-line pt-3">
        {mergeOpen ? (
          <div className="space-y-2 text-[13px]">
            <p className="text-muted">Same thing as another note? Its facts and aliases move there, and this note goes away.</p>
            <select className={field} value={into} onChange={(e) => setInto(e.target.value)}>
              <option value="">Choose a note…</option>
              {others
                .filter((o) => o.id !== note.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {displayName(o.name)} ({o.type})
                  </option>
                ))}
            </select>
            <div className="flex gap-2">
              <button disabled={!into} onClick={merge} className="rounded-md bg-ochre px-3 py-1 font-medium text-sunk disabled:opacity-40">
                Merge into it
              </button>
              <button onClick={() => setMergeOpen(false)} className="rounded-md px-3 py-1 text-muted hover:text-text">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setMergeOpen(true)} className="text-[12.5px] text-muted hover:text-ochre">
            Merge with another note…
          </button>
        )}
      </div>
    </section>
  );
}
