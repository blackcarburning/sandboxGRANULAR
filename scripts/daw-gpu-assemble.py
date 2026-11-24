"""Bounded checkout-only CUDA final stereo assembly using the native DAW routine."""
import fcntl,json,os,pathlib,re,sys,tempfile,time
APP=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APP/'backend'))

def main():
    import cupy as cp
    import mygrain_daw
    folder=pathlib.Path(sys.argv[1])
    scratch=os.environ.get('MYGRAIN_SCRATCH_ROOT') if os.environ.get('MYGRAIN_WORKER_DB') else None
    private=(bool(re.fullmatch(r'/tmp/mygrain-daw-[A-Za-z0-9_-]+',str(folder))) or
             bool(scratch and folder.parent==pathlib.Path(scratch).resolve() and re.fullmatch(r'mygrain-daw-[A-Za-z0-9_-]+',folder.name) and folder.resolve()==folder))
    if not private or folder.is_symlink():
        raise ValueError('Invalid private DAW staging directory.')
    manifest=json.loads((folder/'render-manifest.json').read_text())
    # Checkout holds two slots in the shared four-deck budget. The
    # phase worker retains its own lease while idle for 60 seconds: sharing that
    # lifetime lock would impose a needless minute on every checkout. Bound this
    # separate assembly context and serialize assemblers, not idle warm workers.
    lease=pathlib.Path(tempfile.gettempdir())/f'mygrain-checkout-cuda-{os.getuid()}.lock'
    with lease.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        cp.get_default_memory_pool().set_limit(size=128*1024*1024)
        props=cp.cuda.runtime.getDeviceProperties(0)
        name=props['name'];name=name.decode() if isinstance(name,bytes) else str(name)
        started=time.perf_counter()
        manifest['finalAssembly']={'engine':'CUDA','device':name,'precision':'float64','pcm':'stereo PCM24','nativeInstrumentRenderer':'Web Audio'}
        mygrain_daw.assemble(folder,manifest,folder/'result.zip',array_module=cp)
        cp.cuda.get_current_stream().synchronize()
        print(json.dumps({'engine':'CUDA','device':name,'milliseconds':round((time.perf_counter()-started)*1000)}))
if __name__=='__main__':main()
