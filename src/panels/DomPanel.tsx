import { Fragment, type JSX } from 'react'
import type { DomSnap } from '../model/types'
import { Panel, type PanelProps } from './common'

function attrText(name: string, value: string): string {
  return name === 'className' ? `class="${value}"` : name === 'checked' ? 'checked' : `${name}="${value}"`
}

function changedFromBefore(id: string, now: DomSnap, before: DomSnap): boolean {
  const a = now.nodes[id]
  const b = before.nodes[id]
  if (!b) return true
  if (a.text !== b.text) return true
  return JSON.stringify(a.attrs) !== JSON.stringify(b.attrs) || b.parent !== a.parent
}

function DomTree({
  dom,
  root,
  compare,
  props,
  depth = 0,
}: {
  dom: DomSnap
  root: string
  compare: DomSnap | null
  props: PanelProps
  depth?: number
}): JSX.Element {
  const node = dom.nodes[root]
  if (!node) return <></>
  const { step, selection, onSelect } = props
  const cls = [
    'dom-node',
    compare && step.highlight.dom.includes(node.id) ? 'hl' : '',
    compare && changedFromBefore(node.id, dom, compare) ? 'changed' : '',
    selection?.kind === 'dom' && selection.id === node.id ? 'selected' : '',
  ].join(' ')
  const pad = { paddingLeft: `${depth * 1.2}em` }

  if (node.kind === 'text') {
    return (
      <button className={`${cls} dom-text`} style={pad} onClick={() => onSelect({ kind: 'dom', id: node.id })}>
        “{node.text}” <span className="did">{node.id}</span>
      </button>
    )
  }
  const attrs = Object.entries(node.attrs).map(([k, v]) => attrText(k, v))
  const open = node.kind === 'container' ? '<div id="root">' : `<${node.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
  const selfClosing = node.tag === 'input'
  return (
    <>
      <button className={cls} style={pad} onClick={() => onSelect({ kind: 'dom', id: node.id })}>
        {selfClosing ? open.replace(/>$/, ' />') : open} <span className="did">{node.id}</span>
      </button>
      {node.children.map((c) => (
        <Fragment key={c}>
          <DomTree dom={dom} root={c} compare={compare} props={props} depth={depth + 1} />
        </Fragment>
      ))}
      {!selfClosing && (
        <div className="dom-close" style={pad}>
          {node.kind === 'container' ? '</div>' : `</${node.tag}>`}
        </div>
      )}
    </>
  )
}

export function DomPanel(props: PanelProps & { before: DomSnap }): JSX.Element {
  const { step, before, selection, onSelect } = props
  const current = step.highlight.mutation
  return (
    <Panel letter="E" title="Browser DOM" subtitle="The document before this update, and as the commit replays" badge="model">
      <div className="dom-grid">
        <div className="dom-col">
          <small>Before this update</small>
          <div className="dom-tree">
            <DomTree dom={before} root="container" compare={null} props={props} />
          </div>
        </div>
        <div className="dom-col">
          <small>At this step</small>
          <div className="dom-tree">
            <DomTree dom={step.dom} root="container" compare={before} props={props} />
          </div>
          {step.dom.detached.length > 0 && (
            <div className="detached">
              <small>Created during render, not in the document yet</small>
              {step.dom.detached.map((id) => (
                <DomTree key={id} dom={step.dom} root={id} compare={before} props={props} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mutations">
        <small>DOM mutations applied by commit ({step.mutations.length})</small>
        {step.mutations.length === 0 ? (
          <span className="empty">none yet. React only touches the DOM in the commit phase.</span>
        ) : (
          step.mutations.map((m) => (
            <button
              key={m.index}
              className={`mutation op-${m.op} ${current === m.index ? 'current' : ''} ${selection?.kind === 'mutation' && selection.index === m.index ? 'selected' : ''}`}
              onClick={() => onSelect({ kind: 'mutation', index: m.index })}
            >
              <span className="op">{m.op}</span>
              <code>{m.code}</code>
            </button>
          ))
        )}
      </div>
      {step.effects.length > 0 && (
        <div className="mutations">
          <small>Effects that ran</small>
          {step.effects.map((e) => (
            <button
              key={e.index}
              className={`mutation effect-${e.kind} ${step.highlight.effect === e.index ? 'current' : ''}`}
              onClick={() => onSelect({ kind: 'effect', index: e.index })}
            >
              <span className="op">{e.kind === 'layout' ? 'useLayoutEffect' : 'useEffect'}</span>
              <code>
                {e.component}: {e.message}
              </code>
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}
