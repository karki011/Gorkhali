/**
 * Flow Simulator — multi-flow visualization for the Phantom Works Team.
 * @author Subash Karki
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AnimatePresence, motion } from 'motion/react'
import { CREW, ALL_CREW_NAMES, type CrewMember } from '../data/crew.ts'
import { FLOWS, type Stage, type Flow } from '../data/stages.ts'

// --- Back-edge definitions per flow ---
// Each entry: { source, target, label } — only added if both IDs exist in the flow's stages.
const BACK_EDGES: Record<string, { source: string; target: string; label: string }[]> = {
  feature: [
    { source: 'fixloop', target: 'verify', label: 'retry' },
    { source: 'visual', target: 'quality', label: 'visual fix' },
  ],
  bugfix: [
    { source: 'fixloop', target: 'verify', label: 'retry' },
  ],
  refactor: [],
  spike: [],
  quickfix: [],
}

// --- Stage Node for React Flow ---
const StageNode = ({ data }: { data: { label: string; active: boolean; conditional: boolean } }) => (
  <div
    style={{
      padding: '10px 22px',
      borderRadius: 12,
      background: data.active ? 'var(--orange)' : 'var(--card)',
      border: `2px ${data.conditional ? 'dashed' : 'solid'} ${data.active ? 'var(--orange)' : 'var(--border)'}`,
      color: data.active ? '#fff' : 'var(--muted)',
      fontWeight: 700,
      fontSize: 13,
      cursor: 'pointer',
      transition: 'all 300ms ease',
      boxShadow: data.active ? '0 0 20px rgba(240,136,62,0.4)' : 'none',
      minWidth: 100,
      textAlign: 'center' as const,
    }}
  >
    <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
    {data.conditional && (
      <span style={{
        fontSize: 13,
        background: 'var(--purple)',
        color: '#fff',
        padding: '1px 6px',
        borderRadius: 4,
        display: 'block',
        marginBottom: 4,
      }}>
        CONDITIONAL
      </span>
    )}
    {data.label}
    <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
  </div>
)

const nodeTypes: NodeTypes = { stage: StageNode }

// --- Crew Card ---
const CrewCard = ({ member, isActive, isOptional }: { member: CrewMember; isActive: boolean; isOptional: boolean }) => (
  <motion.div
    layout
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{
      opacity: isActive ? 1 : 0.3,
      scale: isActive ? 1.05 : 0.9,
      filter: isActive ? 'grayscale(0)' : 'grayscale(0.6)',
    }}
    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '14px 18px',
      borderRadius: 14,
      minWidth: 100,
      textAlign: 'center',
      border: `2px ${isOptional ? 'dashed' : 'solid'} ${isActive ? 'var(--orange)' : 'var(--border)'}`,
      background: isActive ? member.color : 'var(--card)',
      boxShadow: isActive ? '0 0 18px rgba(255,160,40,0.35)' : 'none',
      margin: 6,
    }}
  >
    <div style={{ fontSize: 28, marginBottom: 4 }}>{member.emoji}</div>
    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{member.name}</div>
    {isActive && (
      <div style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {member.role.split('/')[0].split('—')[0].trim()}
      </div>
    )}
  </motion.div>
)

// --- Detail Panel ---
const DetailPanel = ({ stage }: { stage: Stage }) => {
  const activeSet = new Set(stage.active)
  const optSet = new Set(stage.optional)

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={stage.id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 28,
          marginTop: 20,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
            {stage.conditional && (
              <span style={{
                fontSize: 13,
                background: 'var(--purple)',
                color: '#fff',
                padding: '2px 8px',
                borderRadius: 6,
                marginRight: 8,
                verticalAlign: 'middle',
              }}>
                CONDITIONAL
              </span>
            )}
            {stage.label}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 600, margin: '0 auto', lineHeight: 1.5 }}>
            {stage.desc}
          </div>
        </div>

        {/* Active crew */}
        <div style={{ textAlign: 'center', marginBottom: 6, fontSize: 13, fontWeight: 700, color: 'var(--orange)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Active
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          {stage.active.map(name => (
            <CrewCard key={name} member={CREW[name]} isActive isOptional={false} />
          ))}
        </div>

        {/* Optional */}
        {stage.optional.length > 0 && (
          <>
            <div style={{ textAlign: 'center', margin: '4px 0', fontSize: 14, color: 'var(--muted)', fontStyle: 'italic' }}>
              Optional / On-demand
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              {stage.optional.map(name => (
                <CrewCard key={name} member={CREW[name]} isActive isOptional />
              ))}
            </div>
          </>
        )}

        {/* Inactive */}
        <div style={{ textAlign: 'center', margin: '8px 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
          Inactive
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap' }}>
          {ALL_CREW_NAMES.filter(n => !activeSet.has(n) && !optSet.has(n)).map(name => (
            <CrewCard key={name} member={CREW[name]} isActive={false} isOptional={false} />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// --- Flow Selector Pill ---
const FlowPill = ({ flow, isSelected, onClick }: { flow: Flow; isSelected: boolean; onClick: () => void }) => (
  <motion.button
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 14px',
      borderRadius: 20,
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      border: `2px solid ${isSelected ? 'var(--orange)' : 'var(--border)'}`,
      background: isSelected ? 'var(--orange)' : 'var(--card)',
      color: isSelected ? '#fff' : 'var(--muted)',
      transition: 'all 200ms ease',
      boxShadow: isSelected ? '0 0 12px rgba(240,136,62,0.3)' : 'none',
    }}
  >
    <span style={{ fontSize: 15 }}>{flow.icon}</span>
    {flow.label}
  </motion.button>
)

// --- Build React Flow nodes/edges for a given flow ---
const buildFlowGraph = (flow: Flow, currentIdx: number) => {
  const stages = flow.stages

  const nodes: Node[] = stages.map((st, i) => ({
    id: st.id,
    type: 'stage',
    position: { x: i * 140, y: 0 },
    data: { label: st.label, active: i === currentIdx, conditional: st.conditional },
  }))

  const edges: Edge[] = stages.slice(0, -1).map((st, i) => ({
    id: `e-${st.id}-${stages[i + 1].id}`,
    source: st.id,
    target: stages[i + 1].id,
    animated: i === currentIdx,
    style: {
      stroke: i === currentIdx ? 'var(--orange)' : 'var(--border)',
      strokeWidth: i === currentIdx ? 2 : 1,
    },
  }))

  // Add flow-specific back-edges (only if both source and target exist in this flow)
  const stageIds = new Set(stages.map(s => s.id))
  const backEdgeDefs = BACK_EDGES[flow.id] ?? []

  for (const def of backEdgeDefs) {
    if (stageIds.has(def.source) && stageIds.has(def.target)) {
      const sourceIdx = stages.findIndex(s => s.id === def.source)
      edges.push({
        id: `e-back-${def.source}-${def.target}`,
        source: def.source,
        target: def.target,
        type: 'default',
        animated: currentIdx === sourceIdx,
        style: { stroke: 'var(--purple)', strokeWidth: 1, strokeDasharray: '5 5' },
        label: def.label,
        labelStyle: { fontSize: 14, fill: 'var(--muted)' },
      })
    }
  }

  return { nodes, edges }
}

// --- Main Simulator ---
export const FlowSimulator = () => {
  const [flowIdx, setFlowIdx] = useState(0)
  const [current, setCurrent] = useState(0)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [autoPlaying, setAutoPlaying] = useState(false)

  const flow = FLOWS[flowIdx]
  const stages = flow.stages

  const stopAuto = useCallback(() => {
    if (autoRef.current) {
      clearInterval(autoRef.current)
      autoRef.current = null
      setAutoPlaying(false)
    }
  }, [])

  const selectFlow = useCallback((idx: number) => {
    stopAuto()
    setFlowIdx(idx)
    setCurrent(0)
  }, [stopAuto])

  const goTo = useCallback((i: number) => setCurrent(i), [])
  const back = useCallback(() => setCurrent(c => Math.max(0, c - 1)), [])
  const next = useCallback(() => setCurrent(c => Math.min(stages.length - 1, c + 1)), [stages.length])
  const reset = useCallback(() => {
    setCurrent(0)
    stopAuto()
  }, [stopAuto])

  const toggleAuto = useCallback(() => {
    if (autoRef.current) {
      stopAuto()
      return
    }
    setAutoPlaying(true)
    autoRef.current = setInterval(() => {
      setCurrent(c => {
        if (c >= stages.length - 1) {
          stopAuto()
          return c
        }
        return c + 1
      })
    }, 2000)
  }, [stages.length, stopAuto])

  useEffect(() => () => { if (autoRef.current) clearInterval(autoRef.current) }, [])

  const { nodes, edges } = buildFlowGraph(flow, current)

  const btnStyle = {
    padding: '8px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600 as const,
    cursor: 'pointer',
    border: '2px solid var(--border)',
    background: 'var(--card)',
    color: 'var(--text)',
    transition: 'all 200ms',
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h2 style={{ textAlign: 'center', marginBottom: 16, fontSize: 18, color: 'var(--muted)', fontStyle: 'italic' }}>
        Phantom Works Team Flow Simulator
      </h2>

      {/* Flow selector */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {FLOWS.map((f, i) => (
          <FlowPill key={f.id} flow={f} isSelected={i === flowIdx} onClick={() => selectFlow(i)} />
        ))}
      </div>

      {/* Flow description */}
      <AnimatePresence mode="wait">
        <motion.div
          key={flow.id}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          style={{ textAlign: 'center', marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}
        >
          {flow.desc}
        </motion.div>
      </AnimatePresence>

      {/* React Flow diagram */}
      <div style={{ height: 100, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--card)' }}>
        <ReactFlow
          key={flow.id}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_e, node) => {
            const idx = stages.findIndex(s => s.id === node.id)
            if (idx >= 0) goTo(idx)
          }}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--border)" />
        </ReactFlow>
      </div>

      {/* Detail panel */}
      <DetailPanel stage={stages[current]} />

      {/* Nav buttons */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button style={btnStyle} onClick={back} disabled={current === 0}>&larr; Back</button>
        <button style={btnStyle} onClick={reset}>Reset</button>
        <button
          style={{ ...btnStyle, background: autoPlaying ? 'var(--orange)' : 'var(--card)', color: autoPlaying ? '#fff' : 'var(--text)' }}
          onClick={toggleAuto}
        >
          {autoPlaying ? '■ Stop' : '▶ Auto-play'}
        </button>
        <button style={btnStyle} onClick={next} disabled={current === stages.length - 1}>Next &rarr;</button>
      </div>

      {/* Next hint */}
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        {current < stages.length - 1 ? (
          <motion.span
            key={`${flow.id}-${current}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              display: 'inline-block',
              padding: '6px 16px',
              borderRadius: 8,
              background: 'rgba(255,160,40,0.1)',
              border: '1px solid rgba(255,160,40,0.3)',
              fontSize: 14,
              color: 'var(--orange)',
            }}
          >
            → Next: {stages[current + 1].label}
          </motion.span>
        ) : (
          <span style={{
            display: 'inline-block',
            padding: '6px 16px',
            borderRadius: 8,
            background: 'rgba(106,249,180,0.15)',
            border: '1px solid rgba(106,249,180,0.4)',
            fontSize: 14,
            color: 'var(--green)',
          }}>
            ✓ Flow complete
          </span>
        )}
      </div>
    </div>
  )
}
