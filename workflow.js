// Ticket delivery Workflow. Run by scriptPath with args:
// {
//   run_id,                           // unique per run; stamped on every document
//   worktree, branch, base,           // base = remote default branch, e.g. "origin/main"
//   ticket: "<key>: <title>\n<why>",
//   criteria: [{ id: "AC1", text: "..." }, ...],
//   facts: "<verified facts; answers to earlier blocking questions>",
//   profile: "<project.md sections the agents need, including baseline quality requirements>",
//   standAllowed: true|false,         // the user's explicit go for shared-stand deploys in this task
//   schemas: { 'design-spec', 'test-plan', 'build-record', 'review-report', 'test-report' }   // parsed schemas/*.schema.json
// }

export const meta = {
  name: 'ticket-delivery',
  description: 'Design spec and test plan, then a test loop around an implement-review loop, then stand testing',
  phases: [{ title: 'Design' }, { title: 'Implement' }, { title: 'Review' }, { title: 'Stand' }],
}

const missing = [
  ...['run_id', 'worktree', 'branch', 'base', 'ticket', 'criteria', 'profile'].filter(k => !args || !args[k]),
  ...['design-spec', 'test-plan', 'build-record', 'review-report', 'test-report'].filter(k => !args || !args.schemas || !args.schemas[k]).map(k => `schemas.${k}`),
]
if (missing.length) return { error: `missing args: ${missing.join(', ')}` }

const { run_id: RUN, worktree: W, branch: BR, base: BASE, ticket, criteria, facts = '', profile, standAllowed = false } = args
const { 'design-spec': DESIGN, 'test-plan': PLAN, 'build-record': BUILD, 'review-report': REVIEW, 'test-report': REPORT } = args.schemas
const AC_IDS = criteria.map(c => c.id)
const COMMON = `Work only in the git worktree ${W} (branch ${BR}). Never modify other checkouts.
TICKET:\n${ticket}\nACCEPTANCE CRITERIA:\n${criteria.map(c => `${c.id}: ${c.text}`).join('\n')}\nFACTS:\n${facts}\nPROJECT PROFILE:\n${profile}`

const short = sha => (sha || '').slice(0, 7)
const sameSha = (a, b) => !!a && !!b && Math.min(a.length, b.length) >= 7 && (a.startsWith(b) || b.startsWith(a))
const artifacts = []
const incidental = []

// Every agent call goes through here: the envelope records who produced which document, on which commit.
async function run(stage, round, label, model, prompt, schema, head) {
  const data = await agent(prompt, { label, phase: stage, schema, model })
  artifacts.push({ meta: { run_id: RUN, stage, round, label, model, head: head || (data && data.head_sha) || null }, data })
  if (data && data.incidental) incidental.push(...data.incidental.map(i => `${label}: ${i}`))
  return data
}

function checkDesign(d) {
  const ids = d.criteria.map(c => c.id)
  return [
    ...AC_IDS.filter(id => !ids.includes(id)).map(id => `criterion ${id} has no design entry`),
    ...ids.filter((id, i) => !AC_IDS.includes(id) || ids.indexOf(id) !== i).map(id => `unknown or duplicate criterion ${id}`),
    ...d.criteria.flatMap(c => c.queries).filter(q => !q.index.trim()).map(q => `query ${q.name} names no index`),
  ]
}
function checkPlan(p) {
  const nfrIds = p.quality_requirements.map(q => q.id)
  const reqIds = [...AC_IDS, ...nfrIds]
  const tcIds = p.test_cases.map(t => t.id)
  return [
    ...nfrIds.filter((id, i) => AC_IDS.includes(id) || nfrIds.indexOf(id) !== i).map(id => `duplicate requirement id ${id}`),
    ...reqIds.filter(id => !p.test_cases.some(t => t.requirement_id === id)).map(id => `requirement ${id} has no test case`),
    ...p.test_cases.filter(t => !reqIds.includes(t.requirement_id)).map(t => `${t.id} traces to unknown requirement ${t.requirement_id}`),
    ...tcIds.filter((id, i) => tcIds.indexOf(id) !== i).map(id => `duplicate test case ${id}`),
  ]
}
const unanswered = (impl, open) => open.filter(f => !impl.responses.some(r => r.finding_id === f.id)).map(f => f.id)
function checkBuild(impl) {
  const g = impl.gate
  return [
    ...LOCAL.filter(id => !impl.automated_tests.some(a => a.test_case_id === id)).map(id => `no automated test for ${id}`),
    ...(sameSha(g.sha, impl.head_sha) ? [] : [`gate ran on ${short(g.sha)}, head is ${short(impl.head_sha)}`]),
    ...g.checks.filter(c => c.exit_code !== 0).map(c => `${c.command} exited ${c.exit_code}: ${c.summary}`),
  ]
}
const meets = (q, v) => (q.op || '<=') === '<=' ? v <= q.threshold : q.op === '>=' ? v >= q.threshold : v === q.threshold

// Failures of derived quality requirements are reported, never sent back to the implementer.
function checkStand(st, head) {
  const blocking = []
  const derived = []
  if (!sameSha(st.sha, head)) blocking.push(`stand tested ${short(st.sha)}, head is ${short(head)}`)
  if (st.ci.conclusion !== 'success') return { blocking: [...blocking, `CI ${st.ci.conclusion}: ${st.ci.failure || st.ci.run_url}`], derived }
  if (!st.build_version.includes(short(head))) blocking.push(`stand reports ${st.build_version}, expected ${short(head)}`)
  for (const t of STAND) {
    const q = NFR[t.requirement_id]
    const sink = q && q.source === 'derived' ? derived : blocking
    const r = st.results.find(x => x.test_case_id === t.id)
    if (!r) { sink.push(`no result for ${t.id}`); continue }
    if (q && !r.measurement) { sink.push(`${t.id} has no measurement for ${q.id}`); continue }
    if (q && meets(q, r.measurement.value) !== (r.verdict === 'pass')) sink.push(`${t.id} verdict ${r.verdict} contradicts ${r.measurement.value} ${r.measurement.unit} against ${q.op || '<='} ${q.threshold}`)
    else if (r.verdict !== 'pass') sink.push(`${t.id} ${r.verdict}: expected ${r.expected}; actual ${r.actual}`)
  }
  return { blocking, derived }
}
function traceability(d, build, st) {
  const what = id => {
    const c = d.criteria.find(x => x.id === id)
    return c ? c.changes.join('; ') : NFR[id] ? `${NFR[id].statement} (${NFR[id].source})` : '—'
  }
  const rows = plan.test_cases.map(t => {
    const auto = build && build.automated_tests.find(a => a.test_case_id === t.id)
    const r = st && st.results.find(x => x.test_case_id === t.id)
    const m = r && r.measurement ? ` [${r.measurement.value} ${r.measurement.unit}, ${r.measurement.environment}]` : ''
    const result = t.runs_on === 'local' ? (auto ? `automated: ${auto.location}` : 'missing')
      : t.runs_on === 'production' ? 'user check on production'
      : r ? `${r.verdict}: ${r.actual}${m}` : 'not run'
    return `| ${t.requirement_id} | ${what(t.requirement_id)} | ${t.id} ${t.title} | ${t.level} | ${t.expected} | ${result} |`
  })
  return ['| Requirement | What | Test case | Level | Expected | Result |', '|---|---|---|---|---|---|', ...rows].join('\n')
}

const [design, plan] = await parallel([
  () => run('Design', 'design', 'design spec', 'fable',
    `${COMMON}\n\nDesigner. Read the code around every acceptance criterion. Any solution or cause proposed in the ticket is a hypothesis: verify it against code and data; if you depart from it, say why. Fill one entry per criterion id, and list the logs, metrics, traces, alerts and dashboards the change needs to be diagnosable in production. Also write it as markdown to ${W}/.tmp/run/design-spec.md.`, DESIGN),
  () => run('Design', 'design', 'test plan', 'opus',
    `${COMMON}\n\nTest designer. Write the test plan from the acceptance criteria, the profile's baseline quality requirements and the current behaviour of the code; you do not see the design. List the quality requirements for this change: the ticket's, the baseline items that apply, and those you derive from ISO/IEC 25010 for this change, each with a metric, threshold and the smallest environment where it can be proven. At least one test case per requirement, plus negative cases. Also write it as markdown to ${W}/.tmp/run/test-plan.md.`, PLAN),
])
if (!design || !plan) return { error: `${!design ? 'design spec' : 'test plan'} agent died`, artifacts }
const contractErrs = [...checkDesign(design), ...checkPlan(plan)]
if (contractErrs.length) return { error: 'design spec or test plan breaks its contract', contractErrs, artifacts }
const blockingQs = design.open_questions.filter(q => q.blocking)
if (blockingQs.length) return { stop: 'blocking open questions: answer them in facts and rerun', questions: blockingQs, artifacts }

const NFR = Object.fromEntries(plan.quality_requirements.map(q => [q.id, q]))
const LOCAL = plan.test_cases.filter(t => t.runs_on === 'local').map(t => t.id)
const STAND = plan.test_cases.filter(t => t.runs_on === 'stand')
const PRODUCTION = plan.test_cases.filter(t => t.runs_on === 'production')
const DESIGN_JSON = JSON.stringify({ criteria: design.criteria, observability: design.observability })
const PLAN_JSON = JSON.stringify({ quality_requirements: plan.quality_requirements, test_cases: plan.test_cases })
const LANES = [
  { key: 'backend', focus: 'correctness, tenancy, parameterised SQL, index use at production size, error handling per project rules; every observability item in the design spec exists with its fields; tests assert behaviour and set every ordering value they assert on' },
  { key: 'criteria', focus: 'each requirement as a user or operator sees it, against its test cases; automated tests really implement their test cases; empty and error states; project UI conventions; no comments that restate code' },
]

let open = []          // findings awaiting resolution; ids assigned here
let feedback = []      // gate and stand failures for the implementer
let head = null
let build = null
let gateOk = false
let stand = null
let derivedFailures = []
const residue = []
const rounds = []

for (let outer = 1; outer <= 3; outer++) {
  stand = null
  let clean = false
  for (let inner = 1; inner <= 3; inner++) {
    const tag = `r${outer}.${inner}`
    const prompt = `${COMMON}\n\nImplementer, round ${tag}. Design spec:\n${DESIGN_JSON}\nTest plan:\n${PLAN_JSON}\nImplement the design, including its observability items, and every test case with runs_on local as an automated test; list them. Commit atomically per the profile; never push, deploy or skip hooks. Then, at your final commit, run every gate command from the profile plus the tests touched by this branch, saving each full output under ${W}/.tmp/run/${tag}/, and report them in gate. If a check fails, fix it and rerun before answering.\nOPEN FINDINGS (answer every id):\n${JSON.stringify(open)}\nSTAND FAILURES AND EARLIER GATE FAILURES:\n${JSON.stringify(feedback)}`
    let impl = await run('Implement', tag, `implement ${tag}`, 'opus', prompt, BUILD)
    if (impl && unanswered(impl, open).length) {
      impl = (await run('Implement', tag, `implement ${tag} (complete)`, 'opus',
        `${prompt}\n\nYour previous answer left these ids unanswered: ${unanswered(impl, open).join(', ')}.`, BUILD)) || impl
    }
    if (!impl) { feedback = [...feedback, { source: 'orchestrator', issue: 'the previous implementer died; inspect git status and log first' }]; continue }
    head = impl.head_sha
    build = impl
    const gateErrs = checkBuild(impl)
    gateOk = !gateErrs.length
    if (!gateOk) {
      feedback = gateErrs.map(e => ({ source: 'gate', issue: e }))
      rounds.push({ round: tag, head: short(head), commits: impl.commits, gate: gateErrs })
      log(`Gate ${tag} @${short(head)} failed: ${gateErrs.length} check(s); no review this round.`)
      continue
    }
    feedback = []

    const lanes = await parallel(LANES.map(l => async () => ({
      lane: l.key,
      r: await run('Review', tag, `review ${l.key} ${tag}`, 'opus',
        `${COMMON}\n\nRead-only reviewer, ${l.key} lane, round ${tag}. Review git -C ${W} diff ${BASE}...${head} against the design spec:\n${DESIGN_JSON}\nand the test plan:\n${PLAN_JSON}\nFocus: ${l.focus}. Anything whose cost grows with table or history size is blocking.\nVerify each implementer response first:\n${JSON.stringify(impl.responses.map(r => ({ ...r, finding: open.find(f => f.id === r.finding_id) })))}\nThen report new findings. reviewed_sha is ${head}.`, REVIEW, head),
    })))
    const returned = lanes.filter(x => x && x.r)
    const fresh = returned.filter(x => sameSha(x.r.reviewed_sha, head))

    const verdicts = fresh.flatMap(x => x.r.verifications)
    const unresolved = new Set(verdicts.filter(v => v.verdict === 'unresolved').map(v => v.finding_id))
    const closed = new Set(verdicts.filter(v => v.verdict !== 'unresolved' && !unresolved.has(v.finding_id)).map(v => v.finding_id))
    open = open.filter(f => !closed.has(f.id))
    fresh.forEach(x => x.r.findings.forEach((f, i) => open.push({ ...f, id: `${tag}-${x.lane}-${i + 1}` })))

    const blocking = open.filter(f => f.severity === 'blocking').length
    const minor = open.length - blocking
    const died = LANES.length - returned.length
    const stale = returned.length - fresh.length
    rounds.push({ round: tag, head: short(head), commits: impl.commits, gate: [], blocking, minor, died, stale })
    log(`Review ${tag} @${short(head)}: ${blocking} blocking, ${minor} minor open, ${died} lane(s) died, ${stale} stale`)
    if (!blocking && !died && !stale) { clean = true; break }
  }
  if (!clean) { log(`Round ${outer}: not clean; next round without the stand.`); continue }

  if (!standAllowed) { log('Stand deploy not authorised; stopping after review.'); break }
  stand = await run('Stand', `stand ${outer}`, `stand test ${outer}`, 'opus',
    `${COMMON}\n\nStand tester, round ${outer}. Never touch production. Push the branch and wait for CI on ${head}; report it in ci. If CI is not green, stop there and return. Otherwise deploy to the stand per the profile and read the build version the stand reports. Run every test case below; seed per its preconditions, reusing earlier seed still on the stand: ${JSON.stringify(residue)}. Functional cases: in a real browser, actual result read from the DOM; screenshots to ${W}/.tmp/run/stand-${outer}/<test case id>.png. Performance cases: plain EXPLAIN first, and EXPLAIN (ANALYZE, BUFFERS) only if every plan uses the design's named index; record the measurement with the stand's row counts for the tables involved. Operational cases: trigger the event, then find it in the stand's logs, metrics or traces and record what you found. Redact ids in evidence.\nQuality requirements:\n${JSON.stringify(plan.quality_requirements)}\nStand test cases:\n${JSON.stringify(STAND)}\nDesign spec queries and observability:\n${JSON.stringify({ queries: design.criteria.map(c => ({ id: c.id, queries: c.queries })), observability: design.observability })}`, REPORT, head)
  if (stand) residue.push(...stand.residue)
  if (stand && stand.blocked) { rounds.push({ round: `stand ${outer}`, blocked: stand.blocked }); break }
  const { blocking: standErrs, derived } = stand ? checkStand(stand, head) : { blocking: ['stand agent died'], derived: [] }
  derivedFailures = derived
  rounds.push({ round: `stand ${outer}`, head: short(head), errors: standErrs, derived })
  if (!standErrs.length) break
  feedback = standErrs.map(e => ({ source: 'stand', issue: e }))
}

const blockingLeft = open.filter(f => f.severity === 'blocking').length
const standOk = !!stand && !stand.blocked && !checkStand(stand, head).blocking.length
return {
  verdict: blockingLeft ? `not ready: ${blockingLeft} blocking finding(s) open`
    : !gateOk ? 'not ready: gate failed'
    : stand && stand.blocked ? `blocked: ${stand.blocked}`
    : !standAllowed ? 'review clean, gate passed; stand not run'
    : standOk ? 'ready' : 'not ready: stand did not pass',
  head,
  traceability: traceability(design, build, stand),
  derived_failures: derivedFailures,
  production_checks: PRODUCTION,
  quality_requirements: plan.quality_requirements,
  open_findings: open,
  residue,
  incidental,
  rounds,
  artifacts,
}
