export const STYLES = `
:host { display: block; }
.nh-root {
  position: relative; overflow: hidden; border-radius: var(--ha-card-border-radius, 16px);
  background: var(--nh-bg); color: var(--nh-text);
  font-family: "Figtree", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px; user-select: none; -webkit-user-select: none; touch-action: none;
}
/* its own stacking context: 3D labels (z-indexed by depth) stay under panels and chips */
.nh-stage { position: absolute; inset: 0; isolation: isolate; z-index: 0; }
.nh-canvas { position: absolute; inset: 0; display: block; outline: none; }
.nh-labels { position: absolute; inset: 0; pointer-events: none; }
.nh-labels > div { pointer-events: none; }

/* bars */
.nh-top { position: absolute; left: 0; right: 0; top: 0; padding: 10px 12px 0; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.nh-row { display: flex; gap: 6px; align-items: center; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; pointer-events: auto; padding-bottom: 2px; }
.nh-row::-webkit-scrollbar { display: none; }
.nh-spacer { flex: 1; }
.nh-title { font-weight: 800; letter-spacing: .02em; font-size: 15px; margin-right: 6px; white-space: nowrap; }
.nh-title i { font-style: normal; color: var(--nh-accent); }
.nh-chip {
  border: 1px solid var(--nh-border); background: var(--nh-pill); color: var(--nh-text);
  border-radius: 999px; padding: 6px 12px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: background .15s, color .15s, box-shadow .15s;
}
.nh-chip:hover { border-color: var(--nh-accent); }
.nh-chip.on { background: var(--nh-accent); color: var(--nh-on-accent); border-color: var(--nh-accent); box-shadow: 0 0 16px -2px var(--nh-accent); }
.nh-chip small { opacity: .7; font-weight: 500; margin-left: 4px; }
.nh-seg { display: inline-flex; border: 1px solid var(--nh-border); border-radius: 999px; background: var(--nh-pill); padding: 2px; backdrop-filter: blur(8px); }
.nh-seg .nh-chip { border: 0; background: transparent; padding: 4px 10px; box-shadow: none; }
.nh-seg .nh-chip.on { background: var(--nh-accent); color: var(--nh-on-accent); }
.nh-group-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--nh-muted); margin: 0 2px 0 6px; white-space: nowrap; }

.nh-bottom { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 12px 10px; display: flex; justify-content: center; pointer-events: none; }
.nh-bottom .nh-row { justify-content: center; flex-wrap: wrap; }

/* labels in the 3D view */
.nh-room {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 4px 10px; border-radius: 10px; background: var(--nh-pill); border: 1px solid var(--nh-border);
  color: var(--nh-text); font-size: 12px; white-space: nowrap; backdrop-filter: blur(6px);
  transform: translateY(-50%);
}
.nh-room b { font-weight: 700; }
.nh-room-sub, .nh-floor-sub { font-size: 10.5px; color: var(--nh-muted); }
.nh-room-sub:empty, .nh-floor-sub:empty { display: none; }
.nh-floor {
  display: flex; flex-direction: column; padding: 8px 14px; border-radius: 12px;
  background: color-mix(in srgb, var(--nh-accent) 22%, var(--nh-panel)); border: 1px solid var(--nh-accent);
  color: var(--nh-text); font-size: 14px; white-space: nowrap; box-shadow: 0 0 22px -6px var(--nh-accent);
  pointer-events: auto !important; cursor: pointer;
}
.nh-badge {
  display: flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; white-space: nowrap;
  background: var(--nh-pill); border: 1px solid var(--nh-border); color: var(--nh-text); font-size: 11px; font-weight: 600;
  backdrop-filter: blur(6px);
}
.nh-badge .ico { color: var(--nh-accent); font-size: 10px; }
.nh-labels > .nh-badge.nh-cam { pointer-events: auto; cursor: pointer; }
.nh-badge.nh-cam:hover { border-color: var(--nh-accent); }
.nh-badge.alarm { background: rgba(255,51,85,.88); border-color: #ff8095; color: #fff; box-shadow: 0 0 18px #ff3355; }
.nh-badge.alarm .ico { color: #fff; }
.nh-badge.active { border-color: var(--nh-accent); box-shadow: 0 0 12px -2px var(--nh-accent); }
.nh-badge.off { opacity: .55; }
.nh-badge .sub { color: var(--nh-muted); font-weight: 500; }
.nh-trail {
  padding: 2px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 700; white-space: nowrap;
  background: rgba(255,90,60,.85); color: #fff;
}
.nh-hidden-labels .nh-room { display: none; }

/* room panel and camera cockpit */
.nh-panel {
  position: absolute; top: 58px; right: 12px; bottom: 58px; width: min(320px, calc(100% - 24px));
  background: var(--nh-panel); border: 1px solid var(--nh-border); border-radius: 16px;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  display: flex; flex-direction: column; overflow: hidden; transform: translateX(110%);
  visibility: hidden; transition: transform .25s ease, visibility 0s linear .25s;
  box-shadow: 0 10px 40px rgba(0,0,0,.35);
}
.nh-panel.open { transform: none; visibility: visible; transition: transform .25s ease; }
.nh-panel header { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px; }
.nh-panel header h3 { margin: 0; font-size: 16px; flex: 1; }
.nh-panel header .sub { color: var(--nh-muted); font-size: 12px; }
.nh-x { border: 0; background: transparent; color: var(--nh-muted); font-size: 18px; cursor: pointer; padding: 2px 6px; }
.nh-list { overflow-y: auto; padding: 0 8px 10px; }
.nh-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 8px; border-radius: 10px; cursor: pointer;
}
.nh-item:hover { background: color-mix(in srgb, var(--nh-accent) 10%, transparent); }
.nh-item .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--nh-muted); flex: none; }
.nh-item.on .dot { background: var(--nh-accent); box-shadow: 0 0 10px var(--nh-accent); }
.nh-item .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nh-item .state { color: var(--nh-muted); font-size: 12px; white-space: nowrap; }
.nh-toggle {
  width: 38px; height: 22px; border-radius: 999px; border: 1px solid var(--nh-border); background: var(--nh-pill);
  position: relative; cursor: pointer; flex: none;
}
.nh-toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--nh-muted); transition: left .15s; }
.nh-toggle.on { background: var(--nh-accent); border-color: var(--nh-accent); }
.nh-toggle.on::after { left: 18px; background: var(--nh-on-accent); }
.nh-attn { font-weight: 800; }
.nh-attn.warn { background: rgba(255,177,61,.18); border-color: #ffb13d; color: #ffd28a; }
.nh-attn.urgent { background: rgba(255,90,60,.25); border-color: #ff6b4a; color: #ffd0c4; box-shadow: 0 0 14px -2px #ff6b4a; }
.nh-attn.ok { color: var(--nh-ok, #35f0a0); opacity: .75; }
.nh-labels > .nh-badge.nh-tap { pointer-events: auto; cursor: pointer; }
.nh-badge.nh-tap:hover { border-color: #ffd23b; }
.nh-badge.nh-watt { font-size: 10px; padding: 1px 6px; border-color: #ffd23b; box-shadow: 0 0 10px -3px #ffd23b; }
.nh-badge.nh-watt.est { border-style: dashed; box-shadow: none; }
.nh-item.nh-load { position: relative; }
.nh-item.nh-load::after {
  content: ""; position: absolute; left: 28px; right: 8px; bottom: 3px; height: 2px; border-radius: 2px; opacity: .6;
  background: linear-gradient(90deg, #ffd23b var(--share), transparent var(--share));
}
.nh-item.nh-load .dot { background: transparent; border: 1px dashed #ffd23b; box-sizing: border-box; }
.nh-item.nh-load.on .dot { background: #ffd23b; border: 0; box-shadow: 0 0 10px #ffd23b; }
.nh-note { color: var(--nh-muted); font-size: 11px; line-height: 1.45; padding: 10px 8px 2px; }
.nh-item.attn .name { white-space: normal; }
.nh-item.attn small { display: block; color: var(--nh-muted); font-size: 11px; margin-top: 1px; }
.nh-item.attn .dot { background: #ffb13d; box-shadow: 0 0 8px #ffb13d; }
.nh-item.attn.sev3 .dot, .nh-item.attn.sev4 .dot { background: #ff5a3c; box-shadow: 0 0 10px #ff5a3c; }
.nh-item.attn.sev1 .dot { background: var(--nh-muted); box-shadow: none; }
.nh-section { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--nh-muted); padding: 10px 8px 4px; }

.nh-cockpit {
  position: absolute; left: 12px; bottom: 58px; width: min(440px, calc(100% - 24px));
  background: var(--nh-panel); border: 1px solid var(--nh-border); border-radius: 16px; overflow: hidden;
  display: none; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,.4);
}
.nh-cockpit.open { display: flex; }
.nh-cockpit.alarm { border-color: #ff3355; box-shadow: 0 0 30px -4px #ff3355; }
.nh-cockpit header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
.nh-cockpit header b { flex: 1; }
.nh-cockpit .live { position: relative; aspect-ratio: 16/9; background: #000; }
.nh-cockpit img { width: 100%; height: 100%; object-fit: cover; display: block; }
.nh-cockpit .rec { position: absolute; left: 8px; top: 8px; font-size: 10px; font-weight: 800; color: #fff; background: rgba(255,51,85,.85); padding: 2px 6px; border-radius: 4px; }
.nh-cockpit .acts { display: flex; gap: 6px; padding: 8px 10px; flex-wrap: wrap; }

.nh-toast {
  position: absolute; left: 50%; top: 64px; transform: translateX(-50%); padding: 6px 12px; border-radius: 10px;
  background: var(--nh-panel); border: 1px solid var(--nh-border); font-size: 12px; opacity: 0; transition: opacity .2s; pointer-events: none;
}
.nh-toast.show { opacity: 1; }
.nh-alert {
  position: absolute; left: 50%; top: 92px; transform: translateX(-50%); padding: 8px 14px; border-radius: 12px;
  background: rgba(255,51,85,.92); color: #fff; font-weight: 700; display: none; box-shadow: 0 0 30px #ff3355; cursor: pointer;
  animation: nh-pulse 1.2s ease-in-out infinite; white-space: nowrap;
}
.nh-alert.show { display: block; }
@keyframes nh-pulse { 50% { box-shadow: 0 0 6px #ff3355; } }
.nh-update {
  position: absolute; left: 50%; bottom: 60px; transform: translateX(-50%); padding: 8px 14px; border-radius: 12px;
  border: 0; font: inherit; font-weight: 700; cursor: pointer; background: var(--nh-accent); color: var(--nh-on-accent);
  box-shadow: 0 0 24px -4px var(--nh-accent); white-space: nowrap;
}
.nh-fps { position: absolute; right: 12px; bottom: 12px; font-size: 10px; color: var(--nh-muted); pointer-events: none; }
.nh-coords {
  position: absolute; right: 12px; bottom: 30px; padding: 4px 9px; border-radius: 8px; font: 600 12px ui-monospace, Consolas, monospace;
  background: var(--nh-pill); border: 1px solid var(--nh-border); color: var(--nh-accent); pointer-events: none; display: none;
}
.nh-coords.show { display: block; }
.nh-warn {
  position: absolute; left: 12px; top: 96px; max-width: min(520px, calc(100% - 24px)); max-height: 45%; overflow: auto;
  background: rgba(60,30,0,.88); border: 1px solid #ffb13d; color: #ffe2b0; border-radius: 12px; font-size: 12px; display: none;
}
.nh-warn.show { display: block; }
.nh-warn summary { cursor: pointer; padding: 7px 12px; font-weight: 700; color: #ffc861; }
.nh-warn ul { margin: 0; padding: 0 14px 10px 30px; }
.nh-warn li { margin: 3px 0; }
.nh-error { padding: 24px; color: #ff8095; font-family: monospace; white-space: pre-wrap; }

@media (max-width: 560px) {
  .nh-title { display: none; }
  .nh-chip { padding: 5px 10px; }
  .nh-panel { top: auto; height: 55%; bottom: 0; right: 0; width: 100%; border-radius: 16px 16px 0 0; transform: translateY(110%); }
}
`;
