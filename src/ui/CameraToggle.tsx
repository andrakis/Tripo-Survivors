// The camera-mode button, and the one line of help orbit mode needs.
//
// A discoverable control rather than a hotkey alone: the hotkey is what a returning viewer uses, but
// the whole reason orbit mode exists is that somebody has just imported a model and wants to look at
// it — and they will not find a key nobody told them about. On a touchscreen there is no key at all.
//
// The hint only appears in orbit mode, and says what the controls are rather than that a mode
// changed. "Drag to orbit" is the sentence a viewer needs; "orbit mode active" is one they can see.

import { useCamera } from '../camera';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export function CameraToggle() {
  const mode = useCamera((s) => s.mode);
  const toggleMode = useCamera((s) => s.toggleMode);
  const orbiting = mode === 'orbit';

  return (
    <>
      <button
        onPointerDown={(e) => {
          // pointerdown rather than click, matching the dash button: a tap-to-click round trip is
          // ~100 ms, and this sits over a canvas that is mid-fight.
          e.preventDefault();
          toggleMode();
        }}
        style={{
          position: 'fixed',
          top: 20,
          right: 12,
          zIndex: 10,
          padding: '6px 10px',
          borderRadius: 4,
          cursor: 'pointer',
          touchAction: 'none',
          background: orbiting ? '#8fe3ff22' : '#0f131aaa',
          border: `1px solid ${orbiting ? '#8fe3ffaa' : '#8fa0b866'}`,
          color: orbiting ? '#8fe3ff' : '#c6d0de',
          font: `700 11px ${MONO}`,
          letterSpacing: 1,
          textShadow: '0 1px 3px #000a',
        }}
      >
        {orbiting ? 'ORBIT' : 'FOLLOW'} <span style={{ opacity: 0.6 }}>C</span>
      </button>

      {orbiting && (
        <div
          style={{
            position: 'fixed',
            top: 52,
            right: 12,
            zIndex: 10,
            pointerEvents: 'none',
            textAlign: 'right',
            color: '#8fa0b8',
            font: `600 10px ${MONO}`,
            lineHeight: 1.7,
            textShadow: '0 1px 3px #000a',
          }}
        >
          drag to orbit · wheel to zoom
          <br />
          R re-centres · movement follows the camera
        </div>
      )}
    </>
  );
}
