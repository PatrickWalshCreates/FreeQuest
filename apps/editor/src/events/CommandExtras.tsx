// Extra controls in a command's dialog, for event pages and common events
// alike: a map picker for transfers, a preview of messages and choices.
import { type PreviewRun, type ProjectDocument, previewText } from '@freequest/editor-core';
import { DEFAULT_UI_THEME, textColor } from '@freequest/runtime';
import { type Command, TEXT_CODE_HELP } from '@freequest/schema';
import { IconImage, useIconset } from '../database/IconField.js';
import { TransferTargetButton } from './TransferTargetButton.js';

export function CommandExtras(props: {
  readonly doc: ProjectDocument;
  readonly command: Command;
  readonly setCommand: (command: Command) => void;
}) {
  const { doc, command, setCommand } = props;
  if (command.type === 'transfer') {
    return <TransferTargetButton doc={doc} command={command} onChange={setCommand} />;
  }
  if (command.type === 'message') {
    return <MessagePreview doc={doc} speaker={command.speaker} text={command.text} />;
  }
  if (command.type === 'choice') {
    return <TextCodeHelp />;
  }
  return null;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** The message as the game's window would show it, codes filled in. */
function MessagePreview(props: {
  readonly doc: ProjectDocument;
  readonly speaker: string | undefined;
  readonly text: string;
}) {
  const { doc } = props;
  const project = doc.project;
  const loaded = useIconset(doc);
  const icons = loaded === 'missing' ? null : loaded;
  const theme = DEFAULT_UI_THEME;
  const speaker = props.speaker
    ? previewText(props.speaker, project)
        .map((r) => (r.kind === 'text' ? r.text : ''))
        .join('')
    : '';
  const runs = previewText(props.text, project);
  return (
    <div className="message-preview-block">
      <span className="muted">Preview (values only the game knows show in [brackets])</span>
      <div
        className="message-preview"
        style={{ background: hex(theme.windowColor), color: hex(theme.textColor) }}
      >
        {speaker && (
          <div className="speaker" style={{ color: hex(theme.speakerColor) }}>
            {speaker}
          </div>
        )}
        <div className="body">
          {runs.length === 0 ? <span className="muted">(empty)</span> : runs.map(drawRun)}
        </div>
      </div>
      <TextCodeHelp />
    </div>
  );

  function drawRun(run: PreviewRun, i: number) {
    if (run.kind === 'icon') {
      return icons && run.icon < icons.count ? (
        <IconImage key={i} icons={icons} index={run.icon} scale={1} />
      ) : (
        <span key={i} className="muted">
          [icon {run.icon}]
        </span>
      );
    }
    return (
      <span key={i} style={{ color: hex(textColor(theme, run.color)) }}>
        {run.text}
      </span>
    );
  }
}

/** The codes text can use, folded away until asked for. */
function TextCodeHelp() {
  return (
    <details className="text-code-help">
      <summary>Codes you can use in the text</summary>
      <table>
        <tbody>
          {TEXT_CODE_HELP.map((h) => (
            <tr key={h.code}>
              <td>
                <code>{h.code}</code>
              </td>
              <td>{h.shows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
