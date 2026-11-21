#!/usr/bin/env python3
"""Brim Sentinel bounded, subscription-CLI orchestration. Standard library only."""
import argparse, datetime as dt, json, os, pathlib, shutil, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARENT = ROOT.parent
BACK = PARENT / 'brim-backend'
FRONT = PARENT / 'brim-frontend'
INTEGRATION = PARENT / 'brim-integration'
LOGDIR = ROOT / 'orchestration' / 'logs'
MAX_SECONDS = 8 * 3600
MAX_REPAIRS = 2
BRANCH = 'automation/brim-sentinel'

class StopRun(Exception): pass

def now(): return dt.datetime.now(dt.timezone.utc).isoformat()
def log(msg):
    line = f'[{now()}] {msg}'
    print(line, flush=True)
    with (LOGDIR / 'run.log').open('a') as f: f.write(line+'\n')

def execute(argv, cwd, deadline, *, label=None, env=None, check=True):
    remaining = deadline - time.monotonic()
    if remaining <= 0: raise StopRun('Eight-hour deadline reached')
    log(f'RUN {label or argv[0]} in {cwd}: {" ".join(argv[:4])}')
    out = LOGDIR / f'{label or "command"}.log'
    with out.open('a') as f:
        f.write(f'\n--- {now()} | {argv!r} ---\n')
        try:
            result = subprocess.run(argv, cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT,
                                    timeout=remaining, check=False)
        except subprocess.TimeoutExpired:
            raise StopRun(f'Timed out: {label or argv[0]}')
    if check and result.returncode:
        raise StopRun(f'Failed ({result.returncode}): {label or argv[0]}; see {out}')
    return result.returncode

def capture(argv, cwd):
    r = subprocess.run(argv, cwd=cwd, text=True, capture_output=True)
    if r.returncode: raise StopRun(f'Git command failed: {argv}: {r.stderr.strip()}')
    return r.stdout.strip()

def clean(w):
    return not capture(['git','status','--porcelain'],w)

def commit_changes(w, message):
    execute(['git','add','-A'],w,DEADLINE,label='stage')
    staged = capture(['git','diff','--cached','--name-only'],w)
    if not staged: raise StopRun(f'Agent made no changes in {w}')
    forbidden = [s for s in staged.splitlines() if s.endswith('.env') or '/.env' in s or 'node_modules/' in s or '/.output/' in s or s.endswith('.db') or s.endswith('.sqlite') or '.DS_Store' in s]
    if forbidden: raise StopRun(f'Forbidden staged files: {forbidden}')
    execute(['git','commit','-m',message],w,DEADLINE,label='commit')
    return capture(['git','rev-parse','HEAD'],w)

def agent(kind, worktree, task, name):
    safe_env = dict(os.environ)
    # Remove inherited API credentials; CLIs should use existing interactive subscription logins.
    for k in list(safe_env):
        if k in ('ANTHROPIC_API_KEY','OPENAI_API_KEY','OPENAI_BASE_URL','ANTHROPIC_BASE_URL') or k.startswith('AWS_'):
            safe_env.pop(k, None)
    safe_env['CI']='1'
    if kind == 'claude':
        # Auto mode is permission-gated by Claude's own risk checks, not an unrestricted bypass.
        cmd = ['claude','-p','--permission-mode','auto',task]
    else:
        cmd = ['codex','exec','--full-auto','-C',str(worktree),task]
    return execute(cmd,worktree,DEADLINE,label=name,env=safe_env,check=False)

def try_agent(kind, worktree, task, name, test_fn):
    last = ''
    for attempt in range(MAX_REPAIRS+1):
        if attempt:
            prompt = task + '\n\nREPAIR ATTEMPT '+str(attempt)+': Your previous run or validation failed. Inspect local changes and logs in orchestration/logs (if present). Fix the errors, do not reset or discard work. Previous issue: '+last
        else: prompt = task
        rc = agent(kind,worktree,prompt,f'{name}-attempt-{attempt}')
        if rc: last=f'agent exit code {rc}'
        else:
            try:
                test_fn(worktree)
                return commit_changes(worktree,f'agent: {name} implementation')
            except StopRun as e: last=str(e)
        log(f'{name} attempt {attempt} failed: {last}')
    raise StopRun(f'{name} failed after {MAX_REPAIRS} repairs: {last}')

def backend_tests(w):
    b=w/'backend'
    if not b.is_dir(): raise StopRun('Missing backend directory')
    if not ((b/'pyproject.toml').exists() or (b/'requirements.txt').exists()):
        raise StopRun('Backend lacks dependency manifest; cannot verify implementation')
    # Use isolated venv per worktree; no automatic installation of external paid services.
    venv=b/'.venv'
    if not venv.exists(): execute([sys.executable,'-m','venv',str(venv)],w,DEADLINE,label='backend-venv')
    pip=str(venv/'bin'/'pip'); python=str(venv/'bin'/'python')
    if (b/'requirements.txt').exists(): execute([pip,'install','-r','requirements.txt'],b,DEADLINE,label='backend-deps')
    else: execute([pip,'install','-e','.[dev]'],b,DEADLINE,label='backend-deps')
    execute([pip,'install','pytest'],b,DEADLINE,label='pytest-install')
    tests=list(b.rglob('test_*.py'))+list((w/'tests').rglob('test_*.py')) if (w/'tests').exists() else list(b.rglob('test_*.py'))
    if not tests: raise StopRun('No backend tests found; refusing unverified push')
    execute([python,'-m','pytest','-q'],w,DEADLINE,label='backend-pytest')

def frontend_tests(w):
    f=w/'frontend'
    if not (f/'package.json').exists(): raise StopRun('Missing frontend/package.json')
    execute(['bun','install','--frozen-lockfile'],f,DEADLINE,label='frontend-install')
    execute(['bun','run','build'],f,DEADLINE,label='frontend-build')
    package=json.loads((f/'package.json').read_text())
    if 'test' not in package.get('scripts',{}): raise StopRun('Frontend test script missing')
    execute(['bun','run','test','--','--run'],f,DEADLINE,label='frontend-vitest')

def integration_tests(w):
    backend_tests(w)
    frontend_tests(w)
    # No Playwright success is claimed unless configured and actually executed.
    f=w/'frontend'; pkg=json.loads((f/'package.json').read_text())
    if 'test:e2e' in pkg.get('scripts',{}):
        execute(['bun','run','test:e2e'],f,DEADLINE,label='playwright')
    else:
        log('WARNING: no test:e2e script. Playwright coverage NOT verified.')

def sync_contract():
    # After backend commit, fast-forward frontend worktree to include the backend commit.
    # This avoids stale OpenAPI contracts before frontend implementation.
    execute(['git','merge','--ff-only','agent/backend'],FRONT,DEADLINE,label='sync-contract')

def make_integration():
    if INTEGRATION.exists(): raise StopRun(f'Integration path already exists: {INTEGRATION}; inspect before rerunning')
    if capture(['git','branch','--list',BRANCH],ROOT):
        raise StopRun(f'Branch {BRANCH} already exists; do not overwrite it')
    execute(['git','worktree','add','-b',BRANCH,str(INTEGRATION),'main'],ROOT,DEADLINE,label='integration-worktree')

def preflight():
    if ROOT.name != 'Brim-Sentinel': raise StopRun('Place orchestration/ inside Brim-Sentinel root')
    for f in ('MASTER_PROMPT.md','PRODUCT.md','ARCHITECTURE.md'):
        if not (ROOT/f).exists(): raise StopRun(f'Missing {f}')
    for exe in ('claude','codex','bun','git'):
        if not shutil.which(exe): raise StopRun(f'Missing executable: {exe}')
    for w,branch in ((ROOT,'main'),(BACK,'agent/backend'),(FRONT,'agent/frontend')):
        if not w.is_dir(): raise StopRun(f'Missing worktree: {w}')
        if capture(['git','branch','--show-current'],w)!=branch: raise StopRun(f'Wrong branch in {w}')
        if not clean(w): raise StopRun(f'Uncommitted changes in {w}; save them before starting')
    if any(os.environ.get(k) for k in ('ANTHROPIC_API_KEY','OPENAI_API_KEY')):
        raise StopRun('API key environment variable present; unset it before running')
    log('Preflight passed: paths, branches, clean worktrees, tools, no API keys in environment')

DEADLINE=0

def main():
    global DEADLINE
    ap=argparse.ArgumentParser()
    ap.add_argument('--preflight',action='store_true',help='Only validate setup, do not invoke agents')
    ap.add_argument('--run',action='store_true',help='Launch real unattended workflow')
    args=ap.parse_args()
    if not (args.preflight or args.run): ap.error('Choose --preflight or --run')
    LOGDIR.mkdir(parents=True,exist_ok=True)
    DEADLINE=time.monotonic()+MAX_SECONDS
    try:
        preflight()
        if args.preflight:
            log('Preflight-only mode complete. No agent called, no branch pushed.')
            return 0
        make_integration()
        common='Read PRODUCT.md (v1.4 amendments prevail), MASTER_PROMPT.md, ARCHITECTURE.md and inspect actual repository. Preserve TanStack Start/Vite/Bun frontend and existing UI. Build real working features, not just plans. Synthetic dataset under data/brim_ap_dataset. Do not call external paid APIs or contact real payment rails. Do not push, merge, switch branches, or modify .git. Do not alter other agent-owned directories. Never fake tests or authorization. Keep code changes scoped to your assigned ownership.'
        backend_task=common+'\nBACKEND OWNERSHIP: backend/, backend tests, OpenAPI schema and backend-owned scripts. Implement the highest-priority end-to-end invoice lifecycle, seeded dataset, financial controls, bank-change holds, approvals, simulated release and audit with tests. Produce generated openapi.json in backend/ if feasible. Prioritize functional vertical slice and deterministic safety. Make actual changes.'
        backend_sha=try_agent('claude',BACK,backend_task,'backend',backend_tests)
        log(f'Backend commit: {backend_sha}')
        sync_contract()
        frontend_task=common+'\nFRONTEND OWNERSHIP: frontend/ and frontend tests ONLY. Backend implementation and contract are now present in this worktree. Inspect backend/openapi.json or FastAPI routes; integrate the existing UI with real API state, role-aware inbox, invoice detail, approval, resolution, payments and audit; preserve existing styling and SSR. Implement meaningful tests. Make actual changes.'
        frontend_sha=try_agent('codex',FRONT,frontend_task,'frontend',frontend_tests)
        log(f'Frontend commit: {frontend_sha}')
        # Frontend branch already contains backend commit, so merge FF to the integrated branch.
        execute(['git','merge','--ff-only','agent/frontend'],INTEGRATION,DEADLINE,label='integrate')
        integration_tests(INTEGRATION)
        execute(['git','push','-u','origin',BRANCH],INTEGRATION,DEADLINE,label='push-validated')
        log(f'SUCCESS: pushed origin/{BRANCH}. Main untouched. No automatic PR merge.')
        return 0
    except (StopRun, OSError, ValueError) as e:
        log(f'STOPPED: {e}')
        return 1

if __name__=='__main__': sys.exit(main())
