// Author: Subash Karki

export const REVIEW_STYLE = `
  :root{--bg:#f3f6f7;--surface:#fff;--surface2:#edf2f3;--surface3:#e4ecee;--border:#d7e0e3;
    --text:#17252b;--muted:#5c6d74;--heading:#002e44;--teal:#55b7bd;--teal-text:#17656a;--teal-soft:#e4f5f5;
    --orange:#fe542e;--orange-text:#a52a12;--orange-soft:#fff0eb;--green:#177245;--green-soft:#e8f6ee;--red:#a72d2d;
    --red-soft:#fceaea;--gutter:clamp(18px,3vw,56px);--shadow:0 8px 28px rgba(0,46,68,.08)}
  @media(prefers-color-scheme:dark){:root{--bg:#091318;--surface:#102128;--surface2:#172d35;
    --surface3:#203943;--border:#29434d;--text:#edf4f5;--muted:#a2b5bc;--heading:#bfecee;
    --teal:#7fcbd0;--teal-text:#7fcbd0;--teal-soft:#15383d;--orange-text:#ff9b85;--orange-soft:#44241d;--green:#87d5aa;--green-soft:#17392a;
    --red:#ffaaaa;--red-soft:#472526;--shadow:0 8px 28px rgba(0,0,0,.22)}}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);
    font:15px/1.58 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  a{color:inherit}a:focus-visible,[tabindex="0"]:focus-visible,summary:focus-visible{outline:3px solid var(--teal);
    outline-offset:3px}.skip{position:fixed;z-index:30;transform:translateY(-160%);background:var(--surface);
    color:var(--text);padding:9px 14px;border-radius:8px}.skip:focus{transform:translateY(0)}
  header{background:linear-gradient(125deg,#002e44 0%,#06475a 58%,#0a5c67 100%);color:#fff;
    border-bottom:4px solid var(--teal)}.header-inner,main,footer{width:min(100%,1600px);margin:auto;
    padding-inline:var(--gutter)}.header-inner{padding-block:34px 22px}.hero-kicker,.eyebrow{font-size:.72rem;
    font-weight:750;letter-spacing:.13em;text-transform:uppercase}.hero-kicker{color:#a9e3e5;margin-bottom:7px}
  .review-brainstorm header{background:linear-gradient(125deg,#082d3a 0%,#12515a 60%,#7b3d25 140%);border-bottom-color:var(--orange)}
  .review-brainstorm .hero-kicker{color:#ffd3c7}.review-brainstorm main{background-image:radial-gradient(circle at 12px 12px,rgba(85,183,189,.14) 1px,transparent 1px);background-size:24px 24px}
  h1{max-width:26ch;margin:0;font-size:clamp(2rem,4vw,3.5rem);line-height:1.02;letter-spacing:-.035em}
  .hero-subtitle{max-width:76ch;margin:14px 0 0;color:#d9edef;font-size:1.04rem}.hero-meta,.chip-list,
  .approach-meta{display:flex;gap:7px;flex-wrap:wrap}.hero-meta{margin-top:18px}.hero-meta .badge{color:#fff;
    border-color:rgba(255,255,255,.24);background:rgba(255,255,255,.1)}nav{display:flex;gap:7px;flex-wrap:wrap;
    margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.16)}.chip,.badge{display:inline-flex;
    align-items:center;border:1px solid var(--border);border-radius:999px;padding:3px 9px;font-size:.73rem;
    font-weight:700;background:var(--surface2);white-space:nowrap}.chip{color:#e7f4f5;background:rgba(255,255,255,.08);
    border-color:rgba(255,255,255,.18);text-decoration:none}.badge.good{color:var(--green);background:var(--green-soft)}
  .badge.warn{color:#8b3b12;background:var(--orange-soft);border-color:#ffc5b2}.badge.bad{color:var(--red);
    background:var(--red-soft);border-color:#efb8b8}main{padding-block:38px 70px}section{margin-bottom:48px;
    scroll-margin-top:16px}h2{display:flex;align-items:center;gap:12px;margin:0 0 18px;color:var(--heading);
    font-size:1.12rem;letter-spacing:-.01em}h2:after{content:"";height:1px;background:var(--border);flex:1}
  h3{margin:0;color:var(--heading);font-size:1.03rem}p{overflow-wrap:anywhere}.muted{color:var(--muted)}
  .card,.band-panel,.task-card,.approach-card{min-width:0;background:var(--surface);border:1px solid var(--border);
    border-radius:18px;box-shadow:var(--shadow)}.card{padding:clamp(18px,2.2vw,30px)}.compact-card{padding:17px}
  .plan-summary-section{margin-bottom:36px}.plan-summary{padding:clamp(24px,3.4vw,48px);border:1px solid var(--border);
    border-left:8px solid var(--teal);border-radius:20px;background:var(--surface);box-shadow:var(--shadow)}
  .plan-summary p{max-width:86ch;margin:0;color:var(--heading);font-size:clamp(1.2rem,1.65vw,1.55rem);font-weight:620;
    line-height:1.55;letter-spacing:-.015em}
  .eyebrow{color:var(--muted);margin-bottom:9px}.decision-spine{display:grid;grid-template-columns:minmax(0,2fr)
    minmax(320px,.82fr);gap:22px}.recommendation{border-top:5px solid var(--teal)}.needs-call,.exploration-status{border-top:5px solid var(--orange)}
  .decision-primary h3{max-width:34ch;font-size:clamp(1.55rem,2.5vw,2.35rem);line-height:1.14;letter-spacing:-.025em}
  .approval-question{display:grid;gap:5px;margin:20px 0;padding:15px 17px;border-left:4px solid var(--teal);
    background:var(--teal-soft);border-radius:0 10px 10px 0}.approval-question span{color:var(--muted);font-size:.72rem;
    font-weight:750;text-transform:uppercase;letter-spacing:.08em}.rationale-list,.clean-list,.decision-list,.check-list,
  .command-list,.file-list{margin:10px 0 0;padding-left:20px}.rationale-list li,.clean-list li,.decision-list li,
  .check-list li,.command-list li,.file-list li{margin:6px 0}.check-list{list-style:"✓  "}.command-list,
  .file-list{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.83rem}.metric-strip{display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:24px}.metric{padding:12px;border-radius:11px;
    background:var(--surface2);border:1px solid var(--border)}.metric strong{display:block;color:var(--heading);
    font-size:1.35rem}.metric span{display:block;color:var(--muted);font-size:.71rem}.rail-heading,.card-head,.task-head,
  .recommended-title,.approach-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
  .decision-rail h3{font-size:1.35rem}.decision-list li{padding:8px 0;border-bottom:1px solid var(--border)}
  .outcome-band{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px}
  .band-panel{padding:20px;box-shadow:none}.outcome-panel{background:var(--heading);color:#fff;border-color:var(--heading)}
  .outcome-panel .eyebrow{color:#9ed9dc}.outcome-goal{max-width:36ch;margin:0;font-size:1.35rem;font-weight:700;
    line-height:1.3}.scope-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.scope-in{border-top:4px solid var(--teal)}
  .scope-out{border-top:4px solid var(--muted)}.scope-constraint{border-top:4px solid var(--orange)}
  .architecture-grid{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.55fr);gap:18px}.architecture-lead{
    max-width:68ch;margin:0 0 18px;color:var(--heading);font-size:1.08rem;font-weight:650}.component-chip{display:inline-flex;
    align-items:center;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);
    font-size:.78rem;font-weight:700}.flow-track{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;
    margin:0;padding:0;list-style:none}.flow-track li{position:relative;min-width:0;padding:14px;background:var(--surface2);
    border:1px solid var(--border);border-radius:12px}.flow-track li>span,.experiment-track li>span{display:grid;place-items:center;
    width:24px;height:24px;border-radius:50%;background:var(--heading);color:var(--surface);font-weight:800;font-size:.75rem}
  .flow-track p{margin:10px 0 0;font-size:.82rem}.evidence-ledger{border:1px solid var(--border);border-radius:18px;
    background:var(--surface);overflow:hidden}.evidence-item{display:grid;grid-template-columns:68px minmax(0,1fr);gap:16px;
    padding:20px;border-bottom:1px solid var(--border)}.evidence-item:last-child{border-bottom:0}.evidence-index{color:var(--teal);
    font:800 .82rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding-top:6px}.evidence-meta{display:flex;
    align-items:center;gap:9px;color:var(--muted);font-size:.78rem}.evidence-body h3{margin:7px 0 0}.evidence-body p{margin:8px 0 0}
  .alternative-grid,.risk-grid,.approach-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:16px}
  .option-index,.task-id{color:var(--teal);font:800 .8rem/1 ui-monospace,SFMono-Regular,Menlo,monospace}
  .alternative-card,.risk-card{height:100%}.alternative-card>p,.risk-card>p{color:var(--muted)}.mini-block,
  .rejected,.accepted-tradeoff{margin-top:15px;padding-top:14px;border-top:1px solid var(--border)}.mini-block>strong,
  .rejected>strong,.accepted-tradeoff>strong,.task-columns strong,.task-footer strong,.approach-split strong,
  .interface-contract>div>strong,.readiness-card>div>strong{font-size:.75rem;
    text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}.rejected{padding:14px;border:1px solid #f2c7ba;
    border-radius:10px;background:var(--orange-soft)}.rejected p,.accepted-tradeoff p{margin:5px 0 0}.decision-confidence{
    display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;color:var(--muted);font-size:.82rem}.validation-grid{
    display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:16px}.validation-strategy{border-left:5px solid var(--teal)}
  .execution-section{margin-top:72px;padding-top:30px;border-top:2px dashed var(--border)}.execution-details{border:1px solid var(--border);
    border-radius:18px;background:var(--surface);overflow:hidden}
  .execution-details>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px;
    cursor:pointer;color:var(--heading);font-weight:800;background:var(--surface2)}.execution-summary-copy{display:grid;gap:3px}
  .execution-summary-copy small{color:var(--muted);font-weight:500}.execution-meta{display:flex;gap:7px;flex-wrap:wrap;padding:16px 18px 0}
  .task-stack{display:grid;gap:14px;padding:18px}
  .task-card{padding:20px;box-shadow:none;border-left:5px solid var(--teal)}.task-head h3{margin-top:7px}.task-action{max-width:78ch}
  .task-columns{display:grid;grid-template-columns:.8fr 1.2fr;gap:20px;margin-top:16px;padding-top:16px;
    border-top:1px solid var(--border)}.task-footer{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;
    margin-top:16px}.task-footer>div{display:grid;gap:5px;padding:12px;border-radius:10px;background:var(--surface2)}
  .interface-contract{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;padding:14px;border:1px solid var(--border);
    border-radius:12px;background:var(--teal-soft)}
  code{overflow-wrap:anywhere;font: .8rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.recommended-title{justify-content:flex-start;align-items:center;flex-wrap:wrap}
  .recommended-title h3{font-size:clamp(1.6rem,2.4vw,2.3rem)}.table-wrap{overflow-x:auto;border:1px solid var(--border);
    border-radius:18px;background:var(--surface)}table{width:100%;min-width:1040px;border-collapse:collapse;table-layout:fixed}
  caption{padding:14px 16px;text-align:left;color:var(--muted);font-size:.8rem}th,td{padding:13px 15px;text-align:left;
    vertical-align:top;border-top:1px solid var(--border);overflow-wrap:anywhere}th{color:var(--heading);background:var(--surface2)}
  th:nth-child(1){width:16%}th:nth-child(2){width:24%}th:nth-child(6){width:24%}.recommended-row,.funnel-label.selected{background:var(--teal-soft)}
  .recommended-row th{box-shadow:inset 5px 0 0 var(--teal)}.approach-card{padding:22px;box-shadow:none}.approach-card.selected{
    border:2px solid var(--teal);box-shadow:var(--shadow)}.approach-head{justify-content:flex-start}.approach-head h3{margin:7px 0 0;
    font-size:1.35rem}.approach-head p{margin:5px 0 0;color:var(--muted)}.approach-description{min-height:3.2em}
  .approach-meta{margin:14px 0}.approach-split{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px;
    padding-top:16px;border-top:1px solid var(--border)}.experiment-track{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;
    margin:0;padding:0;list-style:none}.experiment-track li{display:flex;gap:12px;min-width:0;padding:18px;border:1px solid var(--border);
    border-radius:14px;background:var(--surface)}.experiment-track strong{color:var(--heading)}.experiment-track p{margin:5px 0 0;color:var(--muted)}
  .card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:14px}dl{margin:0}.row{
    padding:10px 0;border-bottom:1px solid var(--border)}.row:last-child{border-bottom:0}dt{color:var(--muted);
    font-size:.75rem;font-weight:750}dd{margin:4px 0 0;overflow-wrap:anywhere}pre{overflow:auto;background:var(--surface2);
    padding:12px;border-radius:8px}footer{padding-block:26px;border-top:1px solid var(--border);color:var(--muted);
    text-align:center;font-size:.78rem;overflow-wrap:anywhere}
  .change-ledger{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--border);border-radius:18px;
    overflow:hidden;background:var(--surface)}.change-column{min-width:0;padding:20px;border-left:1px solid var(--border)}
  .change-column:first-child{border-left:0}.change-added{box-shadow:inset 0 4px 0 var(--teal)}.change-modified{box-shadow:inset 0 4px 0 #b68a21}
  .change-removed{box-shadow:inset 0 4px 0 var(--red)}.change-unchanged{box-shadow:inset 0 4px 0 var(--muted)}
  .scenario-grid,.cluster-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px}.scenario-card{display:grid;
    grid-template-columns:auto minmax(0,1fr);gap:16px;padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}
  .scenario-id{display:grid;place-items:center;align-self:start;width:42px;height:42px;border-radius:12px;background:var(--heading);color:var(--surface);
    font:800 .78rem/1 ui-monospace,SFMono-Regular,Menlo,monospace}.scenario-card dl{display:grid;gap:12px}.scenario-card dt{color:var(--teal-text)}
  .scenario-card dd{margin:3px 0 0}.coverage-table table{min-width:900px}.coverage-table th:nth-child(1){width:32%}
  .coverage-table th:nth-child(2),.coverage-table th:nth-child(3){width:14%}.coverage-table th:nth-child(4){width:40%}
  .readiness-card{display:grid;grid-template-columns:.65fr 1.2fr 1fr;gap:24px;padding:24px;border:1px solid var(--border);
    border-left:7px solid var(--teal);border-radius:18px;background:var(--surface)}.readiness-card h3{font-size:clamp(1.8rem,3vw,2.8rem)}
  .readiness-concerns{border-left-color:var(--orange)}.readiness-blocked{border-left-color:var(--red)}
  .exploration-stagebar{display:grid;grid-template-columns:repeat(5,1fr);margin:0;
    padding:0;list-style:none;border:1px solid var(--border);border-radius:15px;overflow:hidden;background:var(--surface)}
  .exploration-stagebar li{display:flex;align-items:center;gap:9px;min-width:0;padding:13px;border-left:1px solid var(--border);color:var(--muted)}
  .exploration-stagebar li:first-child{border-left:0}.exploration-stagebar li.complete{background:var(--teal-soft);color:var(--heading)}
  .exploration-stagebar li[aria-current="step"]{box-shadow:inset 0 -4px 0 var(--orange)}.exploration-stagebar span{display:grid;place-items:center;
    width:25px;height:25px;border:1px solid currentColor;border-radius:50%;font-size:.72rem}
  .exploration-frame{display:grid;gap:16px}.frame-grid{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;gap:16px}.frame-grid>article{padding:20px;
    border:1px solid var(--border);border-radius:16px;background:var(--surface)}.frame-grid h3{font-size:1.4rem}.frame-grid p{color:var(--muted)}
  .idea-field{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;align-items:start}.idea-lane{margin:0;
    padding:14px;border:1px solid var(--border);border-top:5px solid var(--teal);border-radius:18px;background:var(--surface2)}
  .lane-heading{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:4px 5px 14px}.lane-heading .eyebrow{width:100%;margin:0}.lane-heading h3{flex:1}
  .idea-stack{display:grid;gap:10px}.idea-card{padding:17px;border:1px solid var(--border);border-radius:13px;background:var(--surface)}
  .idea-card h3{margin-top:10px}.idea-card>p{color:var(--muted)}.idea-meta{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .idea-id{color:var(--teal-text);font:800 .78rem/1 ui-monospace,SFMono-Regular,Menlo,monospace}.idea-detail{margin-top:12px;padding-top:11px;
    border-top:1px solid var(--border)}.idea-detail>strong{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
  .cluster-card{padding:22px;border:1px solid var(--border);
    border-radius:18px;background:var(--surface);box-shadow:inset 0 0 0 5px var(--surface2)}.cluster-head{display:flex;gap:13px}.cluster-head>span{display:grid;
    place-items:center;flex:0 0 42px;height:42px;border-radius:50%;background:var(--orange-soft);color:var(--orange-text);font-weight:800}.cluster-card>p{font-size:1.04rem}
  .convergence-funnel{display:grid;grid-template-columns:1.4fr 1fr .7fr;gap:0;margin-bottom:18px}.funnel-label{padding:18px 24px;
    border:1px solid var(--border);background:var(--surface2);clip-path:polygon(0 0,94% 0,100% 50%,94% 100%,0 100%,6% 50%)}
  .funnel-label:first-child{clip-path:polygon(0 0,94% 0,100% 50%,94% 100%,0 100%)}
  .funnel-label span,.funnel-label strong{display:block}.funnel-label span{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}
  .shortlist-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;margin-bottom:18px}.shortlist-card{padding:20px;
    border:1px solid var(--border);border-top:4px solid var(--orange);border-radius:15px;background:var(--surface)}.shortlist-card .chip-list{margin-top:14px}
  .convergence-section .table-wrap{margin-bottom:18px}.dissent-card{display:grid;grid-template-columns:.8fr 1.3fr 1fr;gap:22px;padding:24px;
    border:1px solid #f2c7ba;border-left:7px solid var(--orange);border-radius:18px;background:var(--orange-soft)}.dissent-card>p{margin:0;font-size:1.05rem}
  .reconsider-trigger{padding-left:20px;border-left:1px solid #e7ad9c}.reconsider-trigger p{margin:5px 0 0}.direction-gate{display:grid;
    grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px;align-items:center;padding:26px;border:2px solid var(--orange);border-radius:18px;
    background:var(--surface)}.direction-gate h3{font-size:clamp(1.4rem,2.3vw,2rem)}.gate-options{display:flex;flex-wrap:wrap;gap:9px}
  .gate-options span{padding:9px 13px;border:1px solid var(--border);border-radius:999px;background:var(--surface2);font-weight:700}
  @media(max-width:960px){.decision-spine,.architecture-grid{grid-template-columns:1fr}.scope-grid,.validation-grid,
    .frame-grid{grid-template-columns:1fr 1fr}.change-ledger{grid-template-columns:1fr 1fr}.change-column:nth-child(3){border-left:0}
    .metric-strip{grid-template-columns:repeat(2,1fr)}.experiment-track{grid-template-columns:1fr 1fr}.readiness-card,.dissent-card{grid-template-columns:1fr 1fr}}
  @media(max-width:620px){.header-inner{padding-block:26px 18px}.decision-spine,.outcome-band,.scope-grid,.validation-grid,
    .frame-grid,.task-columns,.approach-split,.interface-contract,.change-ledger,.readiness-card,.dissent-card,
    .direction-gate{grid-template-columns:1fr}.change-column{border-left:0;border-top:1px solid var(--border)}
    .evidence-item{grid-template-columns:45px minmax(0,1fr);padding:16px}.experiment-track{grid-template-columns:1fr}
    .flow-track{grid-template-columns:1fr}.task-head{display:grid}.hero-meta{gap:5px}.exploration-stagebar{display:flex;overflow-x:auto}
    .exploration-stagebar li{flex:0 0 120px}.convergence-funnel{grid-template-columns:1fr}.funnel-label,.funnel-label:first-child{clip-path:none}
    .reconsider-trigger{padding-left:0;border-left:0;border-top:1px solid #e7ad9c;padding-top:14px}nav{flex-wrap:nowrap;overflow-x:auto;padding-bottom:5px}.chip{flex:0 0 auto}}
  @media(prefers-color-scheme:dark){.badge.warn{color:#ffd0bf;border-color:#754334}.outcome-panel{color:#091318}
    .outcome-panel .eyebrow{color:#28525a}
    .flow-track li>span,.experiment-track li>span{color:#091318}}
  @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  @media(forced-colors:active){.recommendation,.needs-call,.task-card,.readiness-card,.dissent-card,.idea-lane,.shortlist-card{border-width:2px}
    .exploration-stagebar li[aria-current="step"]{outline:3px solid CanvasText;outline-offset:-4px}}
  @media print{header{background:#fff;color:#000;border-color:#000}.hero-kicker,.hero-subtitle{color:#333}.hero-meta .badge{
    color:#000;border-color:#777}.skip,nav{display:none}.card,.band-panel,.task-card,.approach-card,.table-wrap{break-inside:avoid;
    box-shadow:none}details>summary{display:none}.execution-details{border:0}.execution-details:not([open])>.execution-body{display:block!important}.task-stack{padding:0}}
`;
