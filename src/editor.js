import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars, placeholder } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html, autoCloseTags } from '@codemirror/lang-html';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';

const studioTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: '#22211d',
      fontSize: '11.5px',
      height: '100%'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      lineHeight: '1.75',
      overflow: 'auto'
    },
    '.cm-content': {
      padding: '12px 0 64px',
      caretColor: '#dd4a2f'
    },
    '.cm-line': { padding: '0 16px 0 14px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#dd4a2f', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(221, 74, 47, 0.14)'
    },
    '.cm-activeLine': { backgroundColor: 'rgba(20, 20, 18, 0.032)' },
    '.cm-placeholder': { color: '#a5a298' },
    '.cm-tooltip': {
      border: '1px solid rgba(20,20,18,0.14)',
      borderRadius: '9px',
      background: '#fbfaf7',
      color: '#141412',
      boxShadow: '0 12px 30px -18px rgba(20,20,18,0.55)',
      overflow: 'hidden'
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      background: 'rgba(221, 74, 47, 0.12)',
      color: '#141412'
    },
    '.cm-completionLabel': { fontSize: '11px' },
    '.cm-completionDetail': { fontSize: '9px', color: '#85827a' }
  },
  { dark: false }
);

const studioHighlight = HighlightStyle.define([
  { tag: tags.comment, color: '#9a978d', fontStyle: 'italic' },
  { tag: [tags.tagName, tags.angleBracket], color: '#b83a2c' },
  { tag: tags.attributeName, color: '#2f6b4f' },
  { tag: [tags.string, tags.attributeValue], color: '#7a5320' },
  { tag: [tags.keyword, tags.operatorKeyword], color: '#a8331e' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: '#a15a33' },
  { tag: [tags.number, tags.color, tags.unit], color: '#1e5f8a' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#2f6b4f' },
  { tag: [tags.variableName, tags.self, tags.standard(tags.variableName)], color: '#3e3d37' },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: '#8b887e' },
  { tag: [tags.bool, tags.null, tags.atom], color: '#a8331e' },
  { tag: tags.heading, fontWeight: '600' }
]);

export function createEditor(host, { value = '', onChange = () => {} } = {}) {
  let suppress = false;
  const editable = new Compartment();
  const listener = EditorView.updateListener.of((update) => {
    if (!update.docChanged || suppress) return;
    onChange(update.state.doc.toString());
  });

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: value,
      extensions: [
        editable.of(EditorView.editable.of(true)),
        history(),
        drawSelection(),
        dropCursor(),
        highlightSpecialChars(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ activateOnTyping: true }),
        html({ autoCloseTags: true }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab
        ]),
        placeholder('Paste a document — or ask the studio to write one.'),
        studioTheme,
        syntaxHighlighting(studioHighlight),
        listener
      ]
    })
  });

  function setValue(text, { silent = true, scrollToEnd = false } = {}) {
    const current = view.state.doc.toString();
    if (current === text) return;
    suppress = silent;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text }
    });
    suppress = false;
    if (scrollToEnd) {
      try {
        view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      } catch (e) {}
    }
  }

  function insert(text) {
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true
    });
    view.focus();
  }

  return {
    view,
    setValue,
    insert,
    getValue: () => view.state.doc.toString(),
    focus: () => view.focus(),
    scrollToEnd: () => {
      try {
        view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      } catch (e) {}
    },
    refresh: () => view.requestMeasure(),
    setReadOnly: (flag) => view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!flag)) })
  };
}
