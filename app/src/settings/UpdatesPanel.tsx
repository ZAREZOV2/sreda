import { useMemo, useState } from "react";
import { parseChangelog } from "../changelog";
import raw from "../../../CHANGELOG.md?raw";

export function UpdatesPanel() {
  const notes = useMemo(() => parseChangelog(raw), []);
  const [open, setOpen] = useState(notes[0]?.version ?? "");
  return (
    <div className="updates">
      <p className="field-hint settings-section-hint">
        Журнал версий читается из одного файла CHANGELOG.md. Новые выпуски дописываются сверху.
      </p>
      {notes.map((note) => {
        const current = open === note.version;
        return (
          <section key={note.version} className={"update-note" + (current ? " is-open" : "")}>
            <button type="button" onClick={() => setOpen(current ? "" : note.version)}>
              <strong>{note.version}</strong>
              <span>{note.title}</span>
              {note.date && <small>{note.date}</small>}
            </button>
            {current && <pre>{note.body}</pre>}
          </section>
        );
      })}
    </div>
  );
}
