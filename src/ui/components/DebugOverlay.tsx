import { useSoloStore } from '../../game/store';

export function DebugOverlay() {
  const d = useSoloStore((s) => s.debug);
  if (!d) return null;
  const f = (n: number) => n.toFixed(2);
  return (
    <pre
      style={{
        position: 'absolute', left: 8, bottom: 8, margin: 0, padding: 8, fontSize: 11, zIndex: 10,
        background: 'rgb(0 0 0 / 0.7)', borderRadius: 8, pointerEvents: 'none', maxWidth: '90%',
      }}
    >
      {`${d.mode}/${d.delegate} ${d.fps} fps
smile ${f(d.smile)}  >${f(d.thresholds.smileLight)} / ${f(d.thresholds.smileFull)}
jaw   ${f(d.jawOpen)}  laugh >${f(d.thresholds.laughSmile)}+${f(d.thresholds.laughJaw)}
head  ${f(d.headOffset)}  >0.10
${d.recent.join('\n')}`}
    </pre>
  );
}
