// Ticket delivery Workflow. Run by scriptPath with args:
// {
//   run_id,                           // unique per run; stamped on every artifact
//   worktree, branch, base,           // base = remote default branch, e.g. "origin/main"
//   ticket: "<key>: <title>\n<why>",
//   criteria: [{ id: "AC1", text: "..." }, ...],
//   facts: "<verified facts; answers to earlier blocking questions>",
//   profile: "<project.md sections the agents need>",
//   standAllowed: true|false,         // the user's explicit go for shared-stand deploys in this task
//   schemas: { 'design-spec', 'test-plan', 'build-record', 'review-report', 'test-report' }   // parsed schemas/*.schema.json
// }

export const meta = {
  name: 'ticket-delivery',
  description: 'Design spec and test plan, then a test loop around an implement-review loop, then system testing on a stand',
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

// Every agent call goes through here: the envelope records who produced what, on which commit.
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
  const ids = p.test_cases.map(t => t.id)
  return [
    ...AC_IDS.filter(id => !p.test_cases.some(t => t.criterion_id === id)).map(id => `criterion ${id} has no test case`),
    ...p.test_cases.filter(t => !AC_IDS.includes(t.criterion_id)).map(t => `${t.id} traces to unknown criterion ${t.criterion_id}`),
    ...ids.filter((id, i) => ids.indexOf(id) !== i).map(id => `duplicate test case ${id}`),
  ]
}
const unanswered = (impl, open) => open.filter(f => !impl.responses.some(r => r.finding_id === f.id)).map(f => f.id)
function checkBuild(impl) {
  const g = impl.gate
  return [
    ...AUTOMATED.filter(id => !impl.automated_tests.some(a => a.test_case_id === id)).map(id => `no automated test for ${id}`),
    ...(sameSha(g.sha, impl.head_sha) ? [] : [`gate ran on ${short(g.sha)}, head is ${short(impl.head_sha)}`]),
    ...g.checks.filter(c => c.exit_code !== 0).map(c => `${c.command} exited ${c.exit_code}: ${c.summary}`),
  ]
}
function checkStand(st, head) {
  const errs = []
  if (!sameSha(st.sha, head)) errs.push(`stand tested ${short(st.sha)}, head is ${short(head)}`)
  if (st.ci.conclusion !== 'success') return [...errs, `CI ${st.ci.conclusion}: ${st.ci.failure || st.ci.run_url}`]
  if (!st.build_version.includes(short(head))) errs.push(`stand reports ${st.build_version}, expected ${short(head)}`)
  for (const id of SYSTEM) {
    const r = st.results.find(x => x.test_case_id === id)
    if (!r) errs.push(`no result for ${id}`)
    else if (r.verdict !== 'pass') errs.push(`${id} ${r.verdict}: expected ${r.expected}; actual ${r.actual}`)
  }
  return errs
}
function traceability(d, p, build, st) {
  const rows = p.test_cases.map(t => {
    const c = d.criteria.find(x => x.id === t.criterion_id)
    const auto = build && build.automated_tests.find(a => a.test_case_id === t.id)
    const r = st && st.results.find(x => x.test_case_id === t.id)
    const result = t.level === 'system' ? (r ? `${r.verdict}: ${r.actual}` : 'not run') : (auto ? `automated: ${auto.location}` : 'missing')
    return `| ${t.criterion_id} | ${c ? c.changes.join('; ') : '—'} | ${t.id} ${t.title} | ${t.level} | ${t.expected} | ${result} |`
  })
  return ['| AC | Change | Test case | Level | Expected | Result |', '|---|---|---|---|---|---|', ...rows].join('\n')
}

const [design, plan] = await parallel([
  () => run('Design', 'design', 'design spec', 'fable',
    `${COMMON}\n\nDesigner. Read the code around every acceptance criterion. Any solution or cause proposed in the ticket is a hypothesis: verify it against code and data; if you depart from it, say why. Fill one entry per criterion id. Also write it as markdown to ${W}/.tmp/run/design-spec.md.`, DESIGN),
  () => run('Design', 'design', 'test plan', 'opus',
    `${COMMON}\n\nTest designer. Write the test plan from the acceptance criteria and the current behaviour of the code; you do not see the design. At least one test case per criterion, plus negative cases. Choose the level of each case: unit and integration become automated tests, system cases run on the deployed stand. Also write it as markdown to ${W}/.tmp/run/test-plan.md.`, PLAN),
])
if (!design || !plan) return { error: `${!design ? 'design spec' : 'test plan'} agent died`, artifacts }
const contractErrs = [...checkDesign(design), ...checkPlan(plan)]
if (contractErrs.length) return { error: 'design spec or test plan breaks its contract', contractErrs, artifacts }
const blockingQs = design.open_questions.filter(q => q.blocking)
if (blockingQs.length) return { stop: 'blocking open questions: answer them in facts and rerun', questions: blockingQs, artifacts }

const AUTOMATED = plan.test_cases.filter(t => t.level !== 'system').map(t => t.id)
const SYSTEM = plan.test_cases.filter(t => t.level === 'system').map(t => t.id)
const PLAN_JSON = JSON.stringify(plan.test_cases)
const DESIGN_JSON = JSON.stringify(design.criteria)
const LANES = [
  { key: 'backend', focus: 'correctness, tenancy, parameterised SQL, index use at production size, error handling per project rules; tests assert behaviour and set every ordering value they assert on' },
  { key: 'criteria', focus: 'each criterion as a user sees it, against its test cases; automated tests really implement their test cases; empty and error states; project UI conventions; no comments that restate code' },
]

let open = []          // findings awaiting resolution; ids assigned here
let feedback = []      // gate and stand failures for the implementer
let head = null
let build = null
let gateOk = false
let stand = null
const residue = []
const rounds = []

for (let outer = 1; outer <= 3; outer++) {
  stand = null
  let clean = false
  for (let inner = 1; inner <= 3; inner++) {
    const tag = `r${outer}.${inner}`
    const prompt = `${COMMON}\n\nImplementer, round ${tag}. Design spec by criterion id:\n${DESIGN_JSON}\nTest plan:\n${PLAN_JSON}\nImplement every unit and integration test case as an automated test and list them. Commit atomically per the profile; never push, deploy or skip hooks. Then, at your final commit, run every gate command from the profile plus the tests touched by this branch, saving each full output under ${W}/.tmp/run/${tag}/, and report them in gate. If a check fails, fix it and rerun before answering.\nOPEN FINDINGS (answer every id):\n${JSON.stringify(open)}\nSTAND FAILURES AND EARLIER GATE FAILURES:\n${JSON.stringify(feedback)}`
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
  if (!clean) { log(`Round ${outer}: not clean; next round without stand.`); continue }

  if (!standAllowed) { log('Stand deploy not authorised; stopping after review.'); break }
  stand = await run('Stand', `stand ${outer}`, `system test ${outer}`, 'opus',
    `${COMMON}\n\nSystem tester, round ${outer}. Never touch production. Push the branch and wait for CI on ${head}; report it in ci. If CI is not green, stop there and return. Otherwise deploy to the stand per the profile and read the build version the stand reports. Run every system test case below in a real browser, reading values from the DOM; seed per each case's preconditions, reusing earlier seed still on the stand: ${JSON.stringify(residue)}. Screenshots to ${W}/.tmp/run/stand-${outer}/<test case id>.png. Run plain EXPLAIN for each design query; only if every plan uses its named index, run EXPLAIN (ANALYZE, BUFFERS). Put index use, timings and the stand's row counts for the tables involved, ids redacted, in the evidence of the matching criterion's cases.\nSystem test cases:\n${JSON.stringify(plan.test_cases.filter(t => t.level === 'system'))}\nDesign spec queries:\n${JSON.stringify(design.criteria.map(c => ({ id: c.id, queries: c.queries })))}`, REPORT, head)
  if (stand) residue.push(...stand.residue)
  if (stand && stand.blocked) { rounds.push({ round: `stand ${outer}`, blocked: stand.blocked }); break }
  const standErrs = stand ? checkStand(stand, head) : ['stand agent died']
  rounds.push({ round: `stand ${outer}`, head: short(head), errors: standErrs })
  if (!standErrs.length) break
  feedback = standErrs.map(e => ({ source: 'stand', issue: e }))
}

const blockingLeft = open.filter(f => f.severity === 'blocking').length
const standOk = !!stand && !stand.blocked && !checkStand(stand, head).length
return {
  verdict: blockingLeft ? `not ready: ${blockingLeft} blocking finding(s) open`
    : !gateOk ? 'not ready: gate failed'
    : stand && stand.blocked ? `blocked: ${stand.blocked}`
    : !standAllowed ? 'review clean, gate passed; stand not run'
    : standOk ? 'ready' : 'not ready: stand did not pass',
  head,
  traceability: traceability(design, plan, build, stand),
  open_findings: open,
  residue,
  incidental,
  rounds,
  artifacts,
}
