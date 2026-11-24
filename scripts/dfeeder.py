#!/usr/bin/env python3
"""Generate any number of Dfeeder candidates through the authenticated server."""
import argparse
import importlib.util
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count',type=int,default=10)
    parser.add_argument('--bpm',type=int,help='68–178; omit for a random BPM per loop')
    parser.add_argument('--user',default='admin')
    parser.add_argument('--base',default='http://127.0.0.1:8765/mygrain/')
    parser.add_argument('--isolated-root',type=pathlib.Path,help='Disposable fixture store only, beneath /tmp')
    args=parser.parse_args()
    base=urlparse(args.base)
    if base.scheme!='http' or base.hostname!='127.0.0.1' or base.path!='/mygrain/' or base.query or base.fragment:
        parser.error('Use a loopback MYGRAIN base URL.')
    if args.count<1 or (args.bpm is not None and not 68<=args.bpm<=178):parser.error('Count must be positive; BPM must be 68–178.')
    workspace=pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0,str(workspace/'fs7300-documenter'))
    spec=importlib.util.spec_from_file_location('dfeeder_cli_server',workspace/'fs7300-documenter/server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
    if args.isolated_root:
        root=args.isolated_root.absolute()
        if '/tmp' not in [str(p) for p in root.parents] or any(p.is_symlink() for p in [root,*root.parents]):parser.error('Fixture root must be a dedicated real directory beneath /tmp.')
        accounts=server.init_account_store(root)
    else:accounts=server.MYGRAIN_ACCOUNTS
    user=accounts.lookup_user(args.user)
    if not user:raise ValueError('Active MYGRAIN user not found.')
    token=accounts.new_session(user)
    def request(path,payload=None):
        req=urllib.request.Request(args.base+'api/dfeeder/'+path,data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Cookie':'mygrain_session='+token,'X-Mygrain-User':user['username'],'Content-Type':'application/json','Origin':f'{base.scheme}://{base.netloc}'})
        try:
            with urllib.request.urlopen(req,timeout=40) as response:return json.load(response)
        except urllib.error.HTTPError as error:
            try:message=json.load(error).get('error','Request failed.')
            except Exception:message='Dfeeder HTTP '+str(error.code)
            raise ValueError(message) from None
    done=0
    try:
        while done<args.count:
            n=min(100,args.count-done);job=request('generate',{'count':n,'bpm':args.bpm})['job'];last='';deadline=time.monotonic()+n*250+180
            print(f"Batch {job['id']}: {n} four-bar loops; BPM {args.bpm or 'random 68–178'}",flush=True)
            while True:
                rows=request('list')['jobs'];job=next((j for j in rows if j['id']==job['id']),None)
                if not job:raise ValueError('Batch is no longer in the server job list.')
                message=f"{done+job['completed']}/{args.count} created · {job['message']}"
                if message!=last:print(message,flush=True);last=message
                if job['state']=='done':break
                if job['state'] not in ('queued','running'):raise ValueError(message)
                if time.monotonic()>deadline:raise ValueError('CLI wait timed out; inspect the still-owned server batch before creating another.')
                time.sleep(3)
            done+=job['completed']
        print(f'{done} candidates ready in SAMPLES_DFEEDER. Review using the Dfeeder card; no candidates were auto-approved.',flush=True)
    finally:accounts.logout(token)

if __name__=='__main__':
    try:main()
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
