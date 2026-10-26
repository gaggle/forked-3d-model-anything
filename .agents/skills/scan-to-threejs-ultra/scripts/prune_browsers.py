#!/usr/bin/env python3
"""Find and stop orphaned or idle agent-browser daemons and their headless Chrome processes.

Every capture worker (cap.sh / cmp_photo.sh) starts an agent-browser daemon per CAP_SESSION, and each
daemon runs its own headless Chrome (~1-2 GB with WebGL). Daemons detach (parent = launchd), so they
outlive the agent, workflow or Claude session that started them. This script only touches daemons
started from Claude (CLAUDECODE=1 in their environment) and the Chrome trees that agent-browser
launched (profile dir `agent-browser-chrome-*`); the user's own browsers are never matched.

A daemon is pruned when
  - the Claude process that launched it (CLAUDE_PID) is gone          → orphan
  - its session has not opened a page for --idle minutes (default 15)  → idle
  - --all is given (end of a run): every Claude-started daemon, or with --session-id only those
    started by that Claude session (CLAUDE_CODE_SESSION_ID)
A Chrome tree is pruned when its parent is not a live agent-browser daemon (its daemon died).

usage: prune_browsers.py [--kill] [--idle MIN] [--all] [--session-id ID] [--keep NAME,...]
                         [--watch SEC] [--clean-profiles]
Without --kill it only reports. --watch repeats every SEC seconds (run it in the background
for the whole workflow). --keep never prunes those session names. --clean-profiles also deletes
`agent-browser-chrome-*` temp profiles that no running Chrome uses.
"""
import argparse, glob, os, re, shutil, signal, subprocess, sys, tempfile, time

STATE = os.path.expanduser('~/.agent-browser')
DAEMON = re.compile(r'/agent-browser(-[a-z0-9-]+)?$|/agent-browser-(darwin|linux|win32)[^ ]*$')
PROFILE = re.compile(r'--user-data-dir=(\S*agent-browser-chrome-[0-9a-f-]+)')


def ps():
    out = subprocess.run(['ps', '-axww', '-o', 'pid=,ppid=,pgid=,rss=,command='], capture_output=True, text=True).stdout
    procs = {}
    for line in out.splitlines():
        parts = line.split(None, 4)
        if len(parts) == 5:
            pid, ppid, pgid, rss = map(int, parts[:4])
            procs[pid] = {'pid': pid, 'ppid': ppid, 'pgid': pgid, 'rss': rss * 1024, 'cmd': parts[4]}
    return procs


def env_of(pid):
    """Environment of one of our own processes (macOS `ps -E`, Linux /proc)."""
    try:
        if os.path.exists(f'/proc/{pid}/environ'):
            raw = open(f'/proc/{pid}/environ', 'rb').read().decode(errors='replace').split('\0')
        else:
            cmd = subprocess.run(['ps', '-E', '-ww', '-o', 'command=', '-p', str(pid)], capture_output=True, text=True).stdout
            raw = cmd.split(' ')
    except OSError:
        return {}
    return dict(t.split('=', 1) for t in raw if re.match(r'^[A-Z_][A-Z0-9_]*=', t))


def is_claude(pid, procs):
    p = procs.get(pid)
    return bool(p) and re.search(r'(^|/)claude( |$)|claude-code|/claude\.app/', p['cmd']) is not None


def gb(n):
    return f'{n / 2**30:.1f} GB'


def tree_rss(root, procs):
    return sum(p['rss'] for p in procs.values() if p['pgid'] == procs[root]['pgid'])


def last_activity(session):
    """cap.sh opens a page on every capture, which rewrites <session>.target."""
    times = [os.path.getmtime(f) for f in glob.glob(f'{STATE}/{glob.escape(session)}.*')]
    return max(times) if times else None


def stop(pid, procs, session=None, binary='agent-browser', grace=5.0):
    """Graceful agent-browser close, then TERM/KILL the daemon and its Chrome process group."""
    groups = {procs[c]['pgid'] for c in procs if procs[c]['ppid'] == pid and PROFILE.search(procs[c]['cmd'])}
    if session:
        try:
            subprocess.run([binary, '--session', session, 'close'], capture_output=True, timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            pass
    targets = [('pid', pid)] + [('pgid', g) for g in groups]
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for kind, n in targets:
            try:
                os.killpg(n, sig) if kind == 'pgid' else os.kill(n, sig)
            except (ProcessLookupError, PermissionError):
                pass
        deadline = time.time() + grace
        while time.time() < deadline and any(alive(kind, n) for kind, n in targets):
            time.sleep(0.2)
        if not any(alive(kind, n) for kind, n in targets):
            return True
    return False


def alive(kind, n):
    if kind == 'pid':
        try:
            os.kill(n, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
    return subprocess.run(['pgrep', '-g', str(n)], capture_output=True).returncode == 0


def sweep(a):
    procs = ps()
    now = time.time()
    keep = set(filter(None, (a.keep or '').split(',')))
    daemons, prune = {}, []
    for p in procs.values():
        if not DAEMON.search(p['cmd'].split(' ')[0]):
            continue
        env = env_of(p['pid'])
        if env.get('AGENT_BROWSER_DAEMON') != '1':
            continue
        daemons[p['pid']] = env
        if env.get('CLAUDECODE') != '1':
            continue  # not started by Claude: the user's own automation
        session = env.get('AGENT_BROWSER_SESSION') or env.get('AGENT_BROWSER_SESSION_NAME') or 'default'
        launcher = int(env.get('CLAUDE_PID', '0') or 0)
        seen = last_activity(session)
        idle = (now - seen) / 60 if seen else None
        reason = None
        if session in keep:
            pass
        elif a.all and (not a.session_id or env.get('CLAUDE_CODE_SESSION_ID') == a.session_id):
            reason = 'end of run'
        elif launcher and not is_claude(launcher, procs):
            reason = f'launcher Claude pid {launcher} is gone'
        elif idle is not None and idle > a.idle:
            reason = f'idle {idle:.0f} min'
        rss = p['rss'] + sum(tree_rss(c, procs) for c in procs if procs[c]['ppid'] == p['pid'] and PROFILE.search(procs[c]['cmd']))
        state = f"idle {idle:.0f} min" if idle is not None else 'no state files'
        print(f"daemon {p['pid']:>6} session {session:<28} {gb(rss):>7}  {state:<16} {('PRUNE: ' + reason) if reason else 'keep'}")
        if reason:
            prune.append((p['pid'], session, rss, p['cmd'].split(' ')[0]))
    # Chrome trees whose daemon is gone (killed, crashed, or pruned above)
    orphans = []
    for p in procs.values():
        m = PROFILE.search(p['cmd'])
        if m and p['pid'] == p['pgid'] and p['ppid'] not in daemons:
            rss = tree_rss(p['pid'], procs)
            print(f"chrome {p['pid']:>6} parent {p['ppid']:<6} {gb(rss):>7}  PRUNE: its agent-browser daemon is gone")
            orphans.append((p['pid'], rss))
    total = sum(r for _, _, r, _ in prune) + sum(r for _, r in orphans)
    print(f"{len(daemons)} daemons, {len(prune)} to prune, {len(orphans)} orphaned Chrome trees, {gb(total)} reclaimable")
    if a.kill:
        for pid, session, _, binary in prune:
            print(f"  stop daemon {pid} ({session}):", 'ok' if stop(pid, procs, session, binary) else 'STILL RUNNING')
        for pid, _ in orphans:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(pid, sig)
                except (ProcessLookupError, PermissionError):
                    break
                time.sleep(2)
            print(f"  stop chrome {pid}:", 'ok' if not alive('pgid', pid) else 'STILL RUNNING')
        if prune:  # drop the stopped sessions' stale .pid/.sock files
            for _, session, _, _ in prune:
                for ext in ('pid', 'sock', 'stream', 'version', 'engine'):
                    try:
                        os.remove(f'{STATE}/{session}.{ext}')
                    except OSError:
                        pass
        for f in glob.glob(f'{STATE}/*.pid'):  # sidecar files of daemons that died without closing
            try:
                dead = not alive('pid', int(open(f).read().strip()))
            except (OSError, ValueError):
                dead = True
            if dead:
                for ext in ('pid', 'sock', 'stream', 'version', 'engine'):
                    try:
                        os.remove(f[:-3] + ext)
                    except OSError:
                        pass
    if a.clean_profiles:
        used = {m.group(1) for p in ps().values() for m in [PROFILE.search(p['cmd'])] if m}
        for d in glob.glob(os.path.join(os.environ.get('TMPDIR', tempfile.gettempdir()), 'agent-browser-chrome-*')):
            if os.path.normpath(d) not in {os.path.normpath(u) for u in used}:
                print(f"  {'remove' if a.kill else 'unused'} profile {d}")
                if a.kill:
                    shutil.rmtree(d, ignore_errors=True)
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--kill', action='store_true', help='stop what is listed (default: report only)')
    ap.add_argument('--idle', type=float, default=15, help='minutes without a page open before a daemon counts as idle')
    ap.add_argument('--all', action='store_true', help='prune every Claude-started daemon (end of a run)')
    ap.add_argument('--session-id', help='with --all: only daemons started by this Claude session')
    ap.add_argument('--keep', help='comma-separated session names never to prune')
    ap.add_argument('--watch', type=float, help='repeat every N seconds')
    ap.add_argument('--clean-profiles', action='store_true', help='delete unused agent-browser-chrome-* temp profiles')
    a = ap.parse_args()
    while True:
        print(time.strftime('[%H:%M:%S]'))
        sweep(a)
        if not a.watch:
            break
        time.sleep(a.watch)


if __name__ == '__main__':
    main()
